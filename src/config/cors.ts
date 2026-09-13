import { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';

/**
 * EMS-style origin allowlist:
 * - localhost / 127.0.0.1 (any port) for Admin (:3001), website (:3000), Expo web
 * - production Admin: errands-admin.netlify.app (+ deploy previews), admin.errandss.co.za
 * - extra origins from CORS_ORIGINS, FRONTEND_URL, ADMIN_URL
 * - requests with no Origin (native iOS/Android, curl, health probes)
 */
export function isOriginAllowed(origin?: string | null): boolean {
  if (!origin) return true;

  let uri: URL;
  try {
    uri = new URL(origin);
  } catch {
    return false;
  }

  const host = uri.hostname.toLowerCase();
  if (host === 'localhost' || host === '127.0.0.1') return true;

  if (host === 'errands-admin.netlify.app' || host.endsWith('--errands-admin.netlify.app')) {
    return true;
  }

  if (host === 'admin.errandss.co.za' || host === 'errandss.co.za' || host === 'www.errandss.co.za') {
    return true;
  }

  if (process.env['NODE_ENV'] !== 'production' && isPrivateLanHost(host)) return true;

  const allowed = configuredOrigins();
  const normalized = `${uri.protocol}//${uri.host}`.replace(/\/$/, '');
  return allowed.has(normalized) || allowed.has(origin.replace(/\/$/, ''));
}

export function corsOptions(): CorsOptions {
  return {
    origin: (origin, callback) => {
      callback(null, isOriginAllowed(origin));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID', 'Accept'],
    maxAge: 600,
  };
}

export function socketCorsOptions() {
  return {
    origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
      callback(null, isOriginAllowed(origin));
    },
    credentials: true,
  };
}

function configuredOrigins(): Set<string> {
  const values = [
    process.env['CORS_ORIGINS'],
    process.env['FRONTEND_URL'],
    process.env['ADMIN_URL'],
  ]
    .filter((value): value is string => Boolean(value))
    .flatMap((value) => value.split(','))
    .map((value) => value.trim().replace(/\/$/, ''))
    .filter(Boolean);

  return new Set(values);
}

function isPrivateLanHost(host: string): boolean {
  return (
    host.startsWith('10.') ||
    host.startsWith('192.168.') ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
  );
}
