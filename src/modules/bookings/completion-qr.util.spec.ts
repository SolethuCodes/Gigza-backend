import { describe, expect, it } from '@jest/globals';
import {
  completionQrSecret,
  createCompletionQrToken,
  hashCompletionToken,
  signCompletionPayload,
  verifyCompletionQrToken,
} from './completion-qr.util';

describe('completion-qr.util', () => {
  const secret = completionQrSecret('test-secret');

  it('round-trips a signed payload', () => {
    const issued = createCompletionQrToken('booking-1', secret);
    const verified = verifyCompletionQrToken(issued.token, secret);
    expect(verified).toEqual(issued.payload);
    expect(hashCompletionToken(issued.token)).toHaveLength(64);
  });

  it('rejects a tampered token', () => {
    const issued = createCompletionQrToken('booking-1', secret);
    expect(() => verifyCompletionQrToken(`${issued.token}x`, secret)).toThrow('INVALID_TOKEN');
  });

  it('rejects an expired token', () => {
    const payload = { bookingId: 'booking-1', nonce: 'abc', exp: Math.floor(Date.now() / 1000) - 10 };
    const token = signCompletionPayload(payload, secret);
    expect(() => verifyCompletionQrToken(token, secret)).toThrow('EXPIRED_TOKEN');
  });
});
