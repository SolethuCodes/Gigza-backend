/**
 * Run `prisma migrate deploy` over a direct (non-pooled) database connection.
 *
 * Migrate takes a session-level Postgres advisory lock. Through Neon's
 * PgBouncer pooler (`-pooler` hosts) the pooled server connection outlives the
 * migrate process and keeps that lock, so the *next* deploy times out with
 * P1002 "Timed out trying to acquire a postgres advisory lock". A direct
 * connection drops the lock as soon as migrate exits.
 *
 * Uses DIRECT_URL when set, otherwise derives it from DATABASE_URL by removing
 * Neon's `-pooler` host suffix. Non-Neon URLs are used unchanged.
 */
const { spawnSync } = require('node:child_process');

const pooledUrl = process.env.DATABASE_URL;
if (!pooledUrl) {
  console.error('[migrate-deploy] DATABASE_URL is not set.');
  process.exit(1);
}

const directUrl = process.env.DIRECT_URL || pooledUrl.replace(/-pooler(\.)/, '$1');
if (directUrl !== pooledUrl) {
  console.log('[migrate-deploy] Using a direct (non-pooled) connection for migrations.');
}

const result = spawnSync('npx', ['prisma', 'migrate', 'deploy'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: { ...process.env, DATABASE_URL: directUrl },
});

process.exit(result.status ?? 1);
