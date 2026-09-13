import { registerAs } from '@nestjs/config';

function isProduction() {
  return process.env['NODE_ENV'] === 'production';
}

function databaseUrl() {
  if (isProduction()) {
    return process.env['DATABASE_URL_PRODUCTION'] ?? process.env['DATABASE_URL'];
  }
  return process.env['DATABASE_URL'] ?? process.env['DATABASE_URL_DEV'];
}

function redisUrl() {
  if (isProduction() && process.env['REDIS_URL_PRODUCTION']) {
    return process.env['REDIS_URL_PRODUCTION'];
  }
  if (process.env['REDIS_URL']) return process.env['REDIS_URL'];

  const host = process.env['REDIS_HOST'] ?? 'localhost';
  const port = process.env['REDIS_PORT'] ?? '6379';
  const password = process.env['REDIS_PASSWORD'];
  const tls =
    isProduction() ||
    ['true', '1', 'yes'].includes(String(process.env['REDIS_TLS'] ?? '').toLowerCase()) ||
    port === '10000' ||
    host.includes('.redis.azure.net');
  const protocol = tls ? 'rediss' : 'redis';
  const auth = password ? `:${encodeURIComponent(password)}@` : '';
  return `${protocol}://${auth}${host}:${port}`;
}

export default registerAs('database', () => ({
  url: databaseUrl(),
  redisUrl: redisUrl(),
}));
