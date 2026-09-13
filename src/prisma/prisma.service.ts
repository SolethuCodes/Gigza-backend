import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { execFileSync } from 'child_process';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { Prisma, PrismaClient } from '@prisma/client';

const MIGRATIONS_DIR = join(process.cwd(), 'prisma', 'migrations');
const PENDING_SCHEMA_MIGRATION = '20260815120000_add_rbac_and_app_config';
const PENDING_SCHEMA_FILE = join(MIGRATIONS_DIR, PENDING_SCHEMA_MIGRATION, 'migration.sql');
const ALREADY_IN_SCHEMA = /already exists|does not exist/i;

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  private static migrationLock: Promise<void> | null = null;

  constructor() {
    super({
      log: [
        { emit: 'event', level: 'query' },
        { emit: 'stdout', level: 'info' },
        { emit: 'stdout', level: 'warn' },
        { emit: 'stdout', level: 'error' },
      ],
    });
  }

  async onModuleInit() {
    await this.$connect();
    await this.applyMigrations();
    this.logger.log('Database connected');
  }

  async onModuleDestroy() {
    await this.$disconnect();
    this.logger.log('Database disconnected');
  }

  /**
   * Same idea as EMS `Database.Migrate()` on boot: apply every pending Prisma
   * migration when the process starts (Azure App Service or local).
   *
   * If Azure already has tables but no `_prisma_migrations` history, older
   * migrations are marked applied first so `migrate deploy` only runs new ones.
   * If a migration's SQL was already applied via `db push` / fallback, it is
   * marked applied and deploy is retried instead of erroring every boot.
   */
  private async applyMigrations() {
    if (process.env['NODE_ENV'] === 'test') return;
    if (!PrismaService.migrationLock) {
      PrismaService.migrationLock = this.runMigrationsSafely();
    }
    await PrismaService.migrationLock;
  }

  private async runMigrationsSafely() {
    try {
      await this.baselineIfNeeded();

      for (let attempt = 0; attempt < 12; attempt += 1) {
        try {
          this.runPrisma(['migrate', 'deploy']);
          this.logger.log('Prisma migrations applied');
          return;
        } catch (error) {
          const output = this.commandOutput(error);
          const failedName = output.match(/Migration name:\s+(\S+)/i)?.[1];

          if (failedName && ALREADY_IN_SCHEMA.test(output)) {
            this.logger.warn(
              `Migration ${failedName} is already reflected in the database — marking it applied`,
            );
            this.runPrisma(['migrate', 'resolve', '--applied', failedName]);
            continue;
          }

          this.logger.warn(`prisma migrate deploy could not finish: ${output.split('\n')[0] ?? output}`);
          await this.applyPendingSchema();
          return;
        }
      }

      await this.applyPendingSchema();
    } catch (error) {
      this.logger.warn(
        `prisma migrate deploy could not finish; applying idempotent schema fallback (${this.commandOutput(error)})`,
      );
      await this.applyPendingSchema();
    }
  }

  private async baselineIfNeeded() {
    const hasHistory = await this.tableExists('_prisma_migrations');
    const hasExistingSchema = await this.tableExists('users');
    if (hasHistory || !hasExistingSchema) return;

    this.logger.log('Existing database has no Prisma history — baselining already-applied migrations');
    const hasAdminRoles = await this.tableExists('admin_roles');

    for (const name of this.listMigrationNames()) {
      if (name === PENDING_SCHEMA_MIGRATION && !hasAdminRoles) continue;
      try {
        this.runPrisma(['migrate', 'resolve', '--applied', name]);
      } catch (error) {
        this.logger.warn(`Could not baseline migration ${name}: ${this.commandOutput(error)}`);
      }
    }
  }

  private async applyPendingSchema() {
    if (!existsSync(PENDING_SCHEMA_FILE)) return;
    if (await this.tableExists('admin_roles') && (await this.tableExists('app_configs'))) {
      return;
    }

    try {
      const sql = readFileSync(PENDING_SCHEMA_FILE, 'utf8');
      for (const statement of splitSqlStatements(sql)) {
        await this.$executeRawUnsafe(statement);
      }
      this.logger.log('Idempotent schema fallback applied');
    } catch (error) {
      this.logger.error('Failed to apply pending database schema', error);
      throw error;
    }
  }

  private listMigrationNames() {
    if (!existsSync(MIGRATIONS_DIR)) return [];
    return readdirSync(MIGRATIONS_DIR)
      .filter((name) => existsSync(join(MIGRATIONS_DIR, name, 'migration.sql')))
      .sort();
  }

  private async tableExists(tableName: string) {
    const rows = await this.$queryRaw<Array<{ exists: boolean }>>(
      Prisma.sql`SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = ${tableName}
      ) AS "exists"`,
    );
    return Boolean(rows[0]?.exists);
  }

  private prismaBin() {
    return join(
      process.cwd(),
      'node_modules',
      '.bin',
      process.platform === 'win32' ? 'prisma.cmd' : 'prisma',
    );
  }

  private runPrisma(args: string[]) {
    try {
      execFileSync(this.prismaBin(), args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: process.env,
        cwd: process.cwd(),
        encoding: 'utf8',
        shell: process.platform === 'win32',
      });
    } catch (error) {
      throw new Error(this.commandOutput(error));
    }
  }

  private commandOutput(error: unknown): string {
    if (!error || typeof error !== 'object') return String(error);
    const err = error as { stdout?: string; stderr?: string; message?: string };
    return [err.stderr, err.stdout, err.message].filter(Boolean).join('\n').trim() || String(error);
  }
}

function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let buffer = '';
  let inDoBlock = false;

  for (const line of sql.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('--')) continue;

    buffer += `${line}\n`;
    if (!inDoBlock && trimmed.startsWith('DO $$')) inDoBlock = true;

    if (inDoBlock && /\$\$;\s*$/.test(trimmed)) {
      statements.push(buffer.trim());
      buffer = '';
      inDoBlock = false;
    } else if (!inDoBlock && /;\s*$/.test(trimmed)) {
      statements.push(buffer.trim());
      buffer = '';
    }
  }

  if (buffer.trim()) statements.push(buffer.trim());
  return statements;
}
