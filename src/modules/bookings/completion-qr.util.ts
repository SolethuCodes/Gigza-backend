import { createHmac, createHash, randomBytes, timingSafeEqual } from 'crypto';

export const COMPLETION_QR_TTL_SECONDS = 15 * 60;

export type CompletionQrPayload = {
  bookingId: string;
  nonce: string;
  exp: number;
};

export function hashCompletionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function createCompletionQrToken(
  bookingId: string,
  secret: string,
  now = Date.now(),
): { token: string; payload: CompletionQrPayload; expiresAt: Date } {
  const payload: CompletionQrPayload = {
    bookingId,
    nonce: randomBytes(16).toString('hex'),
    exp: Math.floor(now / 1000) + COMPLETION_QR_TTL_SECONDS,
  };
  const token = signCompletionPayload(payload, secret);
  return {
    token,
    payload,
    expiresAt: new Date(payload.exp * 1000),
  };
}

export function signCompletionPayload(payload: CompletionQrPayload, secret: string): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifyCompletionQrToken(token: string, secret: string, now = Date.now()): CompletionQrPayload {
  const [body, sig] = token.split('.');
  if (!body || !sig) {
    throw new Error('INVALID_TOKEN');
  }

  const expected = createHmac('sha256', secret).update(body).digest('base64url');
  const actualBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expected);
  if (actualBuf.length !== expectedBuf.length || !timingSafeEqual(actualBuf, expectedBuf)) {
    throw new Error('INVALID_TOKEN');
  }

  let payload: CompletionQrPayload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as CompletionQrPayload;
  } catch {
    throw new Error('INVALID_TOKEN');
  }

  if (!payload?.bookingId || !payload?.nonce || typeof payload.exp !== 'number') {
    throw new Error('INVALID_TOKEN');
  }

  if (payload.exp * 1000 <= now) {
    throw new Error('EXPIRED_TOKEN');
  }

  return payload;
}

export function completionQrSecret(jwtSecret: string | undefined): string {
  return `${jwtSecret ?? 'change-me-in-production'}:booking-completion-qr`;
}
