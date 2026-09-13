import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { RedisService } from '../../services/redis/redis.service';
import {
  APP_CONFIG_CREATE,
  PUBLIC_CONFIG_FIELDS,
  SUPER_ADMIN_FIELDS,
  WRITABLE_CONFIG_FIELDS,
} from './app-config.defaults';

const HEX = /^#([0-9A-Fa-f]{6})$/;
const SNAPSHOT_KEEP = 25;
const MAINTENANCE_KEY = 'app:maintenance';

type ConfigRow = Awaited<ReturnType<PrismaService['appConfig']['findUnique']>>;

@Injectable()
export class SystemService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly redis: RedisService,
  ) {}

  async ensureConfig() {
    const existing = await this.prisma.appConfig.findUnique({ where: { id: 'singleton' } });
    if (existing) return existing;
    try {
      return await this.prisma.appConfig.create({ data: APP_CONFIG_CREATE as never });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return this.prisma.appConfig.findUniqueOrThrow({ where: { id: 'singleton' } });
      }
      throw error;
    }
  }

  toPublic(config: NonNullable<ConfigRow>, options?: { stripHidden?: boolean }) {
    const payload: Record<string, unknown> = {};
    for (const key of PUBLIC_CONFIG_FIELDS) {
      payload[key] = (config as Record<string, unknown>)[key];
    }
    if (!options?.stripHidden) return payload;

    const flags = ((payload['contentFlags'] as Record<string, boolean> | null) ?? {}) as Record<string, boolean>;
    const faqs = Array.isArray(payload['faqs']) ? payload['faqs'] as Array<{ hidden?: boolean }> : [];
    payload['faqs'] = faqs.filter((item) => !item.hidden);

    const stripDoc = (doc: unknown) => {
      if (!doc || typeof doc !== 'object') return doc;
      const typed = doc as { updatedAt?: string; sections?: Array<{ hidden?: boolean }> };
      return {
        ...typed,
        sections: (typed.sections ?? []).filter((section) => !section.hidden),
      };
    };
    payload['legalTerms'] = stripDoc(payload['legalTerms']);
    payload['legalPrivacy'] = stripDoc(payload['legalPrivacy']);

    const slides = Array.isArray(payload['onboardingSlides']) ? payload['onboardingSlides'] as Array<{ hidden?: boolean }> : [];
    payload['onboardingSlides'] = slides.filter((item) => !item.hidden);

    if (flags.helpHero === false) {
      payload['helpHeroTitle'] = '';
      payload['helpHeroBody'] = '';
    }
    if (flags.contactEmail === false) payload['supportEmail'] = '';
    if (flags.contactPhone === false) payload['supportPhone'] = '';
    if (flags.supportHours === false) payload['supportHours'] = '';
    if (flags.faqList === false) payload['faqs'] = [];
    return payload;
  }

  async getPublicConfig() {
    const config = await this.ensureConfig();
    const payload = this.toPublic(config, { stripHidden: true });
    // Surface the platform commission rate so the apps can show providers
    // transparently what share of a booking goes to the platform.
    const settings = await this.prisma.adminSettings
      .findUnique({ where: { id: 'singleton' }, select: { defaultCommissionRate: true } })
      .catch(() => null);
    const rate = Number(settings?.defaultCommissionRate);
    payload['commissionRate'] = Number.isFinite(rate) && rate >= 0 ? rate : 0.15;
    return payload;
  }

  async isMaintenanceEnabled() {
    try {
      const cached = await this.redis.get(MAINTENANCE_KEY);
      if (cached === '1') return true;
      if (cached === '0') return false;
    } catch {
      // fail open if cache is down
    }
    const config = await this.ensureConfig();
    try {
      await this.redis.set(MAINTENANCE_KEY, config.maintenanceMode ? '1' : '0', 60);
    } catch {
      /* ignore */
    }
    return config.maintenanceMode;
  }

  async getMaintenanceMessage() {
    const config = await this.ensureConfig();
    return config.maintenanceMessage;
  }

  async getOverview() {
    const [config, alerts, errors, snapshots, services] = await Promise.all([
      this.ensureConfig(),
      this.prisma.systemAlert.count({ where: { isResolved: false } }).catch(() => 0),
      this.prisma.errorLog.count({ where: { isResolved: false } }).catch(() => 0),
      this.prisma.appConfigSnapshot.count().catch(() => 0),
      this.probeServices(),
    ]);
    const down = services.filter((item) => item.status === 'down').length;
    const degraded = services.filter((item) => item.status === 'degraded').length;
    return {
      overall: down ? 'down' : degraded ? 'degraded' : 'healthy',
      services,
      openAlerts: alerts,
      unresolvedErrors: errors,
      snapshots,
      config: {
        version: config.version,
        platformName: config.platformName,
        maintenanceMode: config.maintenanceMode,
        publishedAt: config.publishedAt,
        updatedAt: config.updatedAt,
        updatedBy: config.updatedBy,
        colorPrimary: config.colorPrimary,
        colorAccent: config.colorAccent,
        colorTeal: config.colorTeal,
      },
    };
  }

  async probeServices() {
    const checks = await Promise.all([
      this.timed('API', async () => true),
      this.timed('Database', async () => {
        await this.prisma.$queryRaw`SELECT 1`;
        return true;
      }),
      this.timed('Redis', async () => {
        await this.redis.ping();
        return true;
      }),
    ]);
    return checks;
  }

  private async timed(name: string, fn: () => Promise<boolean>): Promise<{
    name: string;
    status: 'up' | 'down' | 'degraded';
    latencyMs: number;
  }> {
    const started = Date.now();
    try {
      await fn();
      const latencyMs = Date.now() - started;
      return { name, status: latencyMs > 800 ? 'degraded' : 'up', latencyMs };
    } catch {
      return { name, status: 'down', latencyMs: Date.now() - started };
    }
  }

  async getAdminConfig() {
    return this.ensureConfig();
  }

  async listSnapshots() {
    return this.prisma.appConfigSnapshot.findMany({
      orderBy: { createdAt: 'desc' },
      take: 40,
      select: {
        id: true,
        version: true,
        label: true,
        reason: true,
        createdBy: true,
        createdAt: true,
      },
    });
  }

  async createSnapshot(adminId: string, label?: string, reason?: string) {
    const config = await this.ensureConfig();
    return this.snapshot(config, adminId, label ?? `v${config.version} restore point`, reason);
  }

  async publish(
    patch: Record<string, unknown>,
    actor: { id: string; isSuperAdmin?: boolean },
    meta?: { label?: string; reason?: string },
  ) {
    const current = await this.ensureConfig();
    const data = this.sanitize(patch);
    this.assertSuperAdminFields(data, actor.isSuperAdmin);
    this.validateColors(data);

    await this.snapshot(
      current,
      actor.id,
      meta?.label ?? `Before v${current.version + 1}`,
      meta?.reason ?? 'Automatic backup before publish',
    );

    const updated = await this.prisma.appConfig.update({
      where: { id: 'singleton' },
      data: {
        ...data,
        version: { increment: 1 },
        publishedAt: new Date(),
        updatedBy: actor.id,
      },
    });

    await this.syncAdminSettings(updated);
    await this.cacheMaintenance(updated.maintenanceMode);
    await this.pruneSnapshots();
    await this.audit.log({
      actorId: actor.id,
      actorType: 'admin',
      action: 'APP_CONFIG_PUBLISHED',
      entityType: 'AppConfig',
      entityId: 'singleton',
      metadata: { version: updated.version, fields: Object.keys(data) },
    });
    return updated;
  }

  async restore(snapshotId: string, actor: { id: string; isSuperAdmin?: boolean }, reason?: string) {
    if (!actor.isSuperAdmin) {
      throw new ForbiddenException('Only a Super Admin can restore a previous live configuration');
    }
    const snapshot = await this.prisma.appConfigSnapshot.findUnique({ where: { id: snapshotId } });
    if (!snapshot) throw new NotFoundException('Restore point not found');
    const payload = (snapshot.payload ?? {}) as Record<string, unknown>;
    return this.publish(payload, actor, {
      label: `Before restore of v${snapshot.version}`,
      reason: reason ?? `Restored snapshot ${snapshot.id.slice(0, 8)}`,
    });
  }

  private sanitize(patch: Record<string, unknown>) {
    const data: Record<string, unknown> = {};
    for (const key of WRITABLE_CONFIG_FIELDS) {
      if (patch[key] !== undefined) data[key] = patch[key];
    }
    return data;
  }

  private assertSuperAdminFields(data: Record<string, unknown>, isSuperAdmin?: boolean) {
    const locked = SUPER_ADMIN_FIELDS.filter((key) => data[key] !== undefined);
    if (locked.length && !isSuperAdmin) {
      throw new ForbiddenException('Brand colours and maintenance mode can only be changed by a Super Admin');
    }
  }

  private validateColors(data: Record<string, unknown>) {
    for (const key of ['colorPrimary', 'colorAccent', 'colorTeal'] as const) {
      const value = data[key];
      if (value != null && (typeof value !== 'string' || !HEX.test(value))) {
        throw new BadRequestException(`${key} must be a hex colour such as #0F1C34`);
      }
    }
  }

  private async snapshot(config: NonNullable<ConfigRow>, adminId: string, label?: string, reason?: string) {
    const payload = this.toPublic(config) as Prisma.InputJsonValue;
    return this.prisma.appConfigSnapshot.create({
      data: {
        version: config.version,
        label,
        reason,
        payload,
        createdBy: adminId,
      },
    });
  }

  private async pruneSnapshots() {
    const extra = await this.prisma.appConfigSnapshot.findMany({
      orderBy: { createdAt: 'desc' },
      skip: SNAPSHOT_KEEP,
      select: { id: true },
    });
    if (!extra.length) return;
    await this.prisma.appConfigSnapshot.deleteMany({ where: { id: { in: extra.map((row) => row.id) } } });
  }

  private async cacheMaintenance(enabled: boolean) {
    try {
      await this.redis.set(MAINTENANCE_KEY, enabled ? '1' : '0', 300);
    } catch {
      /* ignore */
    }
  }

  private async syncAdminSettings(config: NonNullable<ConfigRow>) {
    await this.prisma.adminSettings.upsert({
      where: { id: 'singleton' },
      update: {
        platformName: config.platformName,
        supportEmail: config.supportEmail,
        maintenanceMode: config.maintenanceMode,
      },
      create: {
        id: 'singleton',
        platformName: config.platformName,
        supportEmail: config.supportEmail,
        maintenanceMode: config.maintenanceMode,
      },
    });
  }
}
