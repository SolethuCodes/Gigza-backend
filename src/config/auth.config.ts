import { registerAs } from '@nestjs/config';

const AZURE_API =
  process.env['API_PUBLIC_URL'] ??
  'https://errands-backend-api-gya2cva0bmeub7ae.southafricanorth-01.azurewebsites.net';

function callbackUrl(envKey: string, path: string, localFallback: string) {
  if (process.env[envKey]) return process.env[envKey];
  if (process.env['NODE_ENV'] === 'production') return `${AZURE_API.replace(/\/$/, '')}${path}`;
  return localFallback;
}

export default registerAs('auth', () => ({
  jwtSecret: process.env['JWT_SECRET'] ?? 'change-me-in-production',
  jwtExpiresIn: process.env['JWT_EXPIRES_IN'] ?? '15m',
  jwtRefreshSecret: process.env['JWT_REFRESH_SECRET'] ?? 'change-refresh-me-in-production',
  jwtRefreshExpiresIn: process.env['JWT_REFRESH_EXPIRES_IN'] ?? '7d',
  otpExpiryMinutes: parseInt(process.env['OTP_EXPIRY_MINUTES'] ?? '10', 10),
  googleClientId: process.env['GOOGLE_CLIENT_ID'],
  googleClientSecret: process.env['GOOGLE_CLIENT_SECRET'],
  googleCallbackUrl: callbackUrl(
    'GOOGLE_CALLBACK_URL',
    '/api/v1/auth/google/callback',
    'http://localhost:4000/api/v1/auth/google/callback',
  ),
  facebookAppId: process.env['FACEBOOK_APP_ID'],
  facebookAppSecret: process.env['FACEBOOK_APP_SECRET'],
  facebookCallbackUrl: callbackUrl(
    'FACEBOOK_CALLBACK_URL',
    '/api/v1/auth/facebook/callback',
    'http://localhost:4000/api/v1/auth/facebook/callback',
  ),
  bcryptRounds: parseInt(process.env['BCRYPT_ROUNDS'] ?? '12', 10),
  mobileAppScheme: process.env['MOBILE_APP_SCHEME'] ?? 'errands',
  // Native Sign in with Apple (iOS). The identity token's `aud` claim is the
  // app's bundle id for the native flow.
  appleBundleId: process.env['APPLE_BUNDLE_ID'] ?? 'co.za.errands.app',
  appleTeamId: process.env['APPLE_TEAM_ID'],
}));
