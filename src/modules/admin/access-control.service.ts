import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { EmailService } from '../../services/email/email.service';
import {
  ALL_PERMISSIONS,
  PERMISSION_GROUPS,
  slugifyRoleName,
  uniquePermissions,
} from './permissions.catalog';
import { InviteAdminDto, CreateAdminRoleDto, UpdateAdminRoleDto, UpdateStaffDto } from './dto/access-control.dto';

const STAFF_SELECT = {
  id: true,
  email: true,
  phone: true,
  firstName: true,
  lastName: true,
  avatarUrl: true,
  role: true,
  roleId: true,
  inviteStatus: true,
  invitedBy: true,
  invitedAt: true,
  mustChangePassword: true,
  isActive: true,
  isBanned: true,
  banReason: true,
  lastLoginAt: true,
  createdAt: true,
  updatedAt: true,
  roleRef: {
    select: { id: true, name: true, slug: true, permissions: true, isSystem: true },
  },
} satisfies Prisma.AdminSelect;

@Injectable()
export class AccessControlService {
  private readonly logger = new Logger(AccessControlService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
    private readonly email: EmailService,
  ) {}

  catalog() {
    return { groups: PERMISSION_GROUPS, permissions: ALL_PERMISSIONS };
  }

  async ensureSystemRole() {
    const existing = await this.prisma.adminRole.findUnique({ where: { slug: 'super-admin' } });
    const role = existing ?? await this.prisma.adminRole.create({
      data: {
        name: 'Super Admin',
        slug: 'super-admin',
        description: 'Full control of the administrator console',
        permissions: ALL_PERMISSIONS,
        isSystem: true,
      },
    });
    await this.prisma.admin.updateMany({
      where: { roleId: null, role: 'ADMIN' },
      data: { roleId: role.id, inviteStatus: 'ACTIVE', mustChangePassword: false },
    });
    return role;
  }

  async listRoles() {
    await this.ensureSystemRole();
    const roles = await this.prisma.adminRole.findMany({
      orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
      include: { _count: { select: { admins: true } } },
    });
    return roles.map((role) => ({
      id: role.id,
      name: role.name,
      slug: role.slug,
      description: role.description,
      permissions: role.permissions,
      isSystem: role.isSystem,
      adminCount: role._count.admins,
      createdAt: role.createdAt,
      updatedAt: role.updatedAt,
    }));
  }

  async createRole(dto: CreateAdminRoleDto, actorId: string) {
    const permissions = uniquePermissions(dto.permissions);
    if (!permissions.length) throw new BadRequestException('Select at least one permission');
    const slug = await this.uniqueSlug(dto.name);
    const role = await this.prisma.adminRole.create({
      data: {
        name: dto.name.trim(),
        slug,
        description: dto.description?.trim() || null,
        permissions,
      },
    });
    await this.audit.log({
      actorId,
      actorType: 'admin',
      action: 'ADMIN_ROLE_CREATED',
      entityType: 'AdminRole',
      entityId: role.id,
      metadata: { name: role.name, permissions },
    });
    return role;
  }

  async updateRole(id: string, dto: UpdateAdminRoleDto, actorId: string) {
    const role = await this.prisma.adminRole.findUnique({ where: { id } });
    if (!role) throw new NotFoundException('Role not found');
    if (role.isSystem) throw new ForbiddenException('The Super Admin role cannot be edited');

    const data: Prisma.AdminRoleUpdateInput = {};
    if (dto.name?.trim() && dto.name.trim() !== role.name) {
      data.name = dto.name.trim();
      data.slug = await this.uniqueSlug(dto.name, role.id);
    }
    if (dto.description !== undefined) data.description = dto.description?.trim() || null;
    if (dto.permissions) {
      const permissions = uniquePermissions(dto.permissions);
      if (!permissions.length) throw new BadRequestException('Select at least one permission');
      data.permissions = permissions;
    }

    const updated = await this.prisma.adminRole.update({ where: { id }, data });
    await this.audit.log({
      actorId,
      actorType: 'admin',
      action: 'ADMIN_ROLE_UPDATED',
      entityType: 'AdminRole',
      entityId: id,
      metadata: { name: updated.name },
    });
    return updated;
  }

  async deleteRole(id: string, actorId: string) {
    const role = await this.prisma.adminRole.findUnique({
      where: { id },
      include: { _count: { select: { admins: true } } },
    });
    if (!role) throw new NotFoundException('Role not found');
    if (role.isSystem) throw new ForbiddenException('The Super Admin role cannot be deleted');
    if (role._count.admins > 0) {
      throw new BadRequestException('Reassign administrators before deleting this role');
    }
    await this.prisma.adminRole.delete({ where: { id } });
    await this.audit.log({
      actorId,
      actorType: 'admin',
      action: 'ADMIN_ROLE_DELETED',
      entityType: 'AdminRole',
      entityId: id,
      metadata: { name: role.name },
    });
    return { deleted: true };
  }

  async listStaff(page = 1, limit = 20, search?: string, status?: string) {
    await this.ensureSystemRole();
    const where: Prisma.AdminWhereInput = {};
    if (search) {
      where.OR = [
        { email: { contains: search, mode: 'insensitive' } },
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (status && status !== 'all') where.inviteStatus = status.toUpperCase();

    const [admins, total] = await Promise.all([
      this.prisma.admin.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: STAFF_SELECT,
      }),
      this.prisma.admin.count({ where }),
    ]);

    return {
      admins: admins.map((admin) => this.presentStaff(admin)),
      total,
      page,
      limit,
    };
  }

  async getStaff(id: string) {
    const admin = await this.prisma.admin.findUnique({ where: { id }, select: STAFF_SELECT });
    if (!admin) throw new NotFoundException('Administrator not found');
    return this.presentStaff(admin, true);
  }

  async inviteStaff(dto: InviteAdminDto, actorId: string) {
    const email = dto.email.trim().toLowerCase();
    const phone = dto.phone.trim();
    const existing = await this.prisma.admin.findFirst({
      where: { OR: [{ email }, { phone }] },
    });
    if (existing) {
      throw new ConflictException(existing.email === email ? 'Email already registered' : 'Phone already registered');
    }

    const role = await this.resolveRole(dto, actorId);
    if (role.isSystem) {
      throw new ForbiddenException('Invited administrators cannot be assigned Super Admin');
    }

    const created = await this.prisma.admin.create({
      data: {
        email,
        phone,
        firstName: dto.firstName.trim(),
        lastName: dto.lastName.trim(),
        role: 'ADMIN',
        roleId: role.id,
        inviteStatus: 'PENDING',
        invitedBy: actorId,
        invitedAt: new Date(),
        mustChangePassword: true,
        isActive: true,
        passwordHash: 'pending',
      },
    });

    const rounds = this.config.get<number>('auth.bcryptRounds', 12);
    const passwordHash = await bcrypt.hash(created.id, rounds);
    const admin = await this.prisma.admin.update({
      where: { id: created.id },
      data: { passwordHash },
      select: STAFF_SELECT,
    });

    await this.audit.log({
      actorId,
      actorType: 'admin',
      action: 'ADMIN_INVITED',
      entityType: 'Admin',
      entityId: admin.id,
      metadata: { email: admin.email, roleId: role.id, roleName: role.name },
    });

    const emailed = await this.deliverInvitation({
      to: admin.email,
      firstName: admin.firstName,
      roleName: role.name,
      oneTimePassword: created.id,
    });

    return {
      admin: this.presentStaff(admin),
      oneTimePassword: created.id,
      emailed,
      message: emailed
        ? 'Invitation emailed. The administrator ID is the one-time password for first sign-in.'
        : 'Administrator created. Share the administrator ID as a one-time password — the invitation email could not be sent.',
    };
  }

  async updateStaff(id: string, dto: UpdateStaffDto, actorId: string) {
    const admin = await this.prisma.admin.findUnique({
      where: { id },
      include: { roleRef: true },
    });
    if (!admin) throw new NotFoundException('Administrator not found');
    if (admin.roleRef?.isSystem && actorId !== id) {
      throw new ForbiddenException('The Super Admin account cannot be reassigned');
    }

    const data: Prisma.AdminUpdateInput = {};
    if (dto.firstName?.trim()) data.firstName = dto.firstName.trim();
    if (dto.lastName?.trim()) data.lastName = dto.lastName.trim();
    if (dto.roleId || dto.roleName) {
      const role = await this.resolveRole({
        roleId: dto.roleId,
        roleName: dto.roleName,
        permissions: dto.permissions,
      }, actorId);
      if (role.isSystem) throw new ForbiddenException('Invited administrators cannot be assigned Super Admin');
      data.roleRef = { connect: { id: role.id } };
    }

    const updated = await this.prisma.admin.update({ where: { id }, data, select: STAFF_SELECT });
    await this.audit.log({
      actorId,
      actorType: 'admin',
      action: 'ADMIN_UPDATED',
      entityType: 'Admin',
      entityId: id,
    });
    return this.presentStaff(updated);
  }

  async disableStaff(id: string, actorId: string, reason?: string) {
    if (id === actorId) throw new BadRequestException('You cannot disable your own account');
    const admin = await this.prisma.admin.findUnique({ where: { id }, include: { roleRef: true } });
    if (!admin) throw new NotFoundException('Administrator not found');
    if (admin.roleRef?.isSystem) throw new ForbiddenException('The Super Admin account cannot be disabled');

    const updated = await this.prisma.admin.update({
      where: { id },
      data: {
        isActive: false,
        isBanned: true,
        banReason: reason || 'Disabled by Super Admin',
        bannedAt: new Date(),
        bannedBy: actorId,
        inviteStatus: 'DISABLED',
      },
      select: STAFF_SELECT,
    });
    await this.audit.log({
      actorId,
      actorType: 'admin',
      action: 'ADMIN_DISABLED',
      entityType: 'Admin',
      entityId: id,
      metadata: { reason: reason || 'Disabled by Super Admin' },
    });
    return this.presentStaff(updated);
  }

  async enableStaff(id: string, actorId: string) {
    const admin = await this.prisma.admin.findUnique({ where: { id } });
    if (!admin) throw new NotFoundException('Administrator not found');
    const updated = await this.prisma.admin.update({
      where: { id },
      data: {
        isActive: true,
        isBanned: false,
        banReason: null,
        bannedAt: null,
        bannedBy: null,
        inviteStatus: admin.mustChangePassword ? 'PENDING' : 'ACTIVE',
      },
      select: STAFF_SELECT,
    });
    await this.audit.log({
      actorId,
      actorType: 'admin',
      action: 'ADMIN_RESTORED',
      entityType: 'Admin',
      entityId: id,
    });
    return this.presentStaff(updated);
  }

  async revealOneTimePassword(id: string, actorId: string) {
    const admin = await this.prisma.admin.findUnique({ where: { id }, select: STAFF_SELECT });
    if (!admin) throw new NotFoundException('Administrator not found');
    if (admin.inviteStatus !== 'PENDING' || !admin.mustChangePassword) {
      throw new BadRequestException('This administrator has already activated their account');
    }
    await this.audit.log({
      actorId,
      actorType: 'admin',
      action: 'ADMIN_OTP_REVEALED',
      entityType: 'Admin',
      entityId: id,
    });
    const emailed = await this.deliverInvitation({
      to: admin.email,
      firstName: admin.firstName,
      roleName: admin.roleRef?.name ?? 'Administrator',
      oneTimePassword: admin.id,
    });
    return { adminId: admin.id, oneTimePassword: admin.id, emailed };
  }

  async getStaffActivity(id: string, page = 1, limit = 80) {
    const admin = await this.prisma.admin.findUnique({ where: { id }, select: STAFF_SELECT });
    if (!admin) throw new NotFoundException('Administrator not found');

    const [logs, total] = await Promise.all([
      this.prisma.activityLog.findMany({
        where: {
          OR: [
            { adminId: id },
            { entityType: 'Admin', entityId: id },
          ],
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.activityLog.count({
        where: {
          OR: [
            { adminId: id },
            { entityType: 'Admin', entityId: id },
          ],
        },
      }),
    ]);

    const events: Array<{
      id: string;
      at: Date;
      source: string;
      action: string;
      summary: string;
      metadata: Record<string, unknown>;
    }> = logs.map((log) => ({
      id: log.id,
      at: log.createdAt,
      source: 'audit',
      action: log.action,
      summary: log.action.replace(/_/g, ' '),
      metadata: (log.metadata as Record<string, unknown> | null) ?? {},
    }));

    if (admin.lastLoginAt) {
      events.unshift({
        id: `login-${admin.id}`,
        at: admin.lastLoginAt,
        source: 'account',
        action: 'LAST_LOGIN',
        summary: 'Last successful sign-in',
        metadata: {},
      });
    }

    return { events, total, page, limit, admin: this.presentStaff(admin) };
  }

  async getAuditLogs(scope: 'admin' | 'client' | 'all' = 'all', page = 1, limit = 30, search?: string) {
    const where: Prisma.ActivityLogWhereInput = {};
    if (scope === 'admin') {
      where.OR = [
        { adminId: { not: null } },
        { AND: [{ userId: null }, { providerId: null }] },
      ];
    } else if (scope === 'client') {
      where.AND = [
        { OR: [{ userId: { not: null } }, { providerId: { not: null } }] },
        { adminId: null },
      ];
    }
    if (search) {
      where.AND = [
        ...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []),
        {
          OR: [
            { action: { contains: search, mode: 'insensitive' } },
            { entityType: { contains: search, mode: 'insensitive' } },
            { entityId: { contains: search, mode: 'insensitive' } },
          ],
        },
      ];
    }

    const [logs, total] = await Promise.all([
      this.prisma.activityLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          user: { select: { email: true, firstName: true, lastName: true } },
          provider: { select: { email: true, firstName: true, lastName: true } },
          admin: { select: { email: true, firstName: true, lastName: true, roleRef: { select: { name: true } } } },
        },
      }),
      this.prisma.activityLog.count({ where }),
    ]);

    return { logs, total, page, limit };
  }

  private async resolveRole(
    dto: { roleId?: string; roleName?: string; roleDescription?: string; permissions?: string[] },
    actorId: string,
  ) {
    if (dto.roleId) {
      const role = await this.prisma.adminRole.findUnique({ where: { id: dto.roleId } });
      if (!role) throw new NotFoundException('Role not found');
      return role;
    }
    if (dto.roleName) {
      const permissions = uniquePermissions(dto.permissions ?? []);
      if (!permissions.length) throw new BadRequestException('Select at least one permission for the new role');
      return this.createRole(
        { name: dto.roleName, description: dto.roleDescription, permissions },
        actorId,
      );
    }
    throw new BadRequestException('Select an existing role or create a new one');
  }

  private async deliverInvitation(params: {
    to: string;
    firstName: string;
    roleName: string;
    oneTimePassword: string;
  }) {
    try {
      await this.email.sendAdminInvitation(params);
      return true;
    } catch (error) {
      this.logger.error(`Failed to email invitation to ${params.to}`, error);
      return false;
    }
  }

  private async uniqueSlug(name: string, excludeId?: string) {
    const base = slugifyRoleName(name) || 'role';
    let slug = base;
    let i = 2;
    while (true) {
      const clash = await this.prisma.adminRole.findUnique({ where: { slug } });
      if (!clash || clash.id === excludeId) return slug;
      slug = `${base}-${i++}`;
    }
  }

  private presentStaff(
    admin: Prisma.AdminGetPayload<{ select: typeof STAFF_SELECT }>,
    revealContact = false,
  ) {
    const isSuperAdmin = Boolean(admin.roleRef?.isSystem) || !admin.roleId;
    return {
      id: admin.id,
      firstName: admin.firstName,
      lastName: admin.lastName,
      email: revealContact ? admin.email : undefined,
      phone: revealContact ? admin.phone : undefined,
      maskedEmail: this.maskEmail(admin.email),
      maskedPhone: this.maskPhone(admin.phone),
      role: admin.role,
      roleId: admin.roleId,
      roleName: admin.roleRef?.name ?? (isSuperAdmin ? 'Super Admin' : 'Administrator'),
      permissions: isSuperAdmin ? ALL_PERMISSIONS : (admin.roleRef?.permissions ?? []),
      isSuperAdmin,
      inviteStatus: admin.inviteStatus,
      mustChangePassword: admin.mustChangePassword,
      isActive: admin.isActive,
      isBanned: admin.isBanned,
      lastLoginAt: admin.lastLoginAt,
      invitedAt: admin.invitedAt,
      createdAt: admin.createdAt,
    };
  }

  private maskEmail(email: string) {
    const [local, domain] = email.split('@');
    if (!local || !domain) return '***';
    return `${local[0]}${'*'.repeat(Math.max(3, local.length - 1))}@${domain}`;
  }

  private maskPhone(phone: string) {
    if (!phone || phone.length < 4) return '***';
    return `${phone.slice(0, 3)}${'*'.repeat(Math.max(3, phone.length - 5))}${phone.slice(-2)}`;
  }
}
