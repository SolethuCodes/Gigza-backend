import { registerAs } from '@nestjs/config';

export default registerAs('sumsub', () => ({
  baseUrl: process.env['SUMSUB_BASE_URL'] ?? 'https://api.sumsub.com',
  appToken: process.env['SUMSUB_APP_TOKEN'],
  secretKey: process.env['SUMSUB_SECRET_KEY'],
  // Verification flow configured in the Sumsub dashboard (Dashboard → Verification levels).
  // Must match a level name that actually exists on the account, or every token request 4xxs.
  levelName: process.env['SUMSUB_LEVEL_NAME'] ?? 'id-and-liveness',
  // Separate from secretKey — generated per-webhook in Dashboard → Integrations → Webhooks
  // when the callback URL is registered. Used only to verify inbound webhook signatures.
  webhookSecret: process.env['SUMSUB_WEBHOOK_SECRET'],
}));
