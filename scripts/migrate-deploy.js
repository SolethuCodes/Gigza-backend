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
 * Neon's `-pooler` host suffix. Non-Neon URLs are used unchanged. The advisory
 * lock is also disabled outright as a fallback.
 */
const { spawnSync } = require('node:child_process');

const pooledUrl = process.env.DATABASE_URL;
if (!pooledUrl) {
  console.error('[migrate-deploy] DATABASE_URL is not set.');
  process.exit(1);
}

const directUrl = process.env.DIRECT_URL || pooledUrl.replace(/-pooler(\.)/, '$1');
const hostOf = (url) => {
  try {
    return new URL(url).host;
  } catch {
    return 'unparseable URL';
  }
};
console.log(`[migrate-deploy] Migrating via ${hostOf(directUrl)}${directUrl === pooledUrl ? ' (unchanged DATABASE_URL)' : ' (direct)'}.`);

const result = spawnSync('npx', ['prisma', 'migrate', 'deploy'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: {
    ...process.env,
    DATABASE_URL: directUrl,
    // Belt and braces: even if the URL above still routes through a pooler,
    // skip the advisory lock altogether. Safe here — there is a single
    // instance and Render runs deploys one at a time.
    PRISMA_SCHEMA_DISABLE_ADVISORY_LOCK: '1',
  },
});

process.exit(result.status ?? 1);
