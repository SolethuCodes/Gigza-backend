import { registerAs } from '@nestjs/config';

export default registerAs('app', () => ({
  nodeEnv: process.env['NODE_ENV'] ?? 'development',
  port: parseInt(process.env['PORT'] ?? '4000', 10),
  corsOrigins: (process.env['CORS_ORIGINS'] ??
    'http://localhost:3000,http://localhost:3001,http://localhost:8081')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  throttleTtl: parseInt(process.env['THROTTLE_TTL'] ?? '60000', 10),
  throttleLimit: parseInt(process.env['THROTTLE_LIMIT'] ?? '100', 10),
  frontendUrl: process.env['FRONTEND_URL'] ?? 'http://localhost:3000',
  passwordResetUrl: process.env['PASSWORD_RESET_URL'] ?? process.env['FRONTEND_URL'] ?? 'http://localhost:3000',
  adminUrl: process.env['ADMIN_URL'] ?? 'http://localhost:3001',
  sentryDsn: process.env['SENTRY_DSN'],
  uploadMaxSize: parseInt(process.env['UPLOAD_MAX_SIZE_MB'] ?? '10', 10) * 1024 * 1024,
}));
