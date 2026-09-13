import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, createPublicKey, type KeyObject } from 'crypto';
import axios from 'axios';
import * as jwt from 'jsonwebtoken';

const APPLE_ISSUER = 'https://appleid.apple.com';
const APPLE_KEYS_URL = 'https://appleid.apple.com/auth/keys';
const KEYS_TTL_MS = 60 * 60 * 1000;

interface AppleJwk {
  kid: string;
  kty: string;
  n: string;
  e: string;
  alg: string;
  use: string;
}

export interface VerifiedAppleIdentity {
  sub: string;
  email?: string;
  emailVerified: boolean;
  isPrivateEmail: boolean;
}

/**
 * Verifies the identity token returned by the native Sign in with Apple flow:
 * signature (against Apple's rotating public keys), issuer, audience (the app
 * bundle id) and the replay-protection nonce.
 */
@Injectable()
export class AppleTokenVerifier {
  private readonly logger = new Logger(AppleTokenVerifier.name);
  private keyCache: { keys: AppleJwk[]; fetchedAt: number } | null = null;

  constructor(private readonly config: ConfigService) {}

  async verify(identityToken: string, rawNonce: string): Promise<VerifiedAppleIdentity> {
    const bundleId = this.config.get<string>('auth.appleBundleId');
    if (!bundleId) {
      throw new UnauthorizedException('Sign in with Apple is not configured.');
    }

    const decoded = jwt.decode(identityToken, { complete: true });
    if (!decoded || typeof decoded === 'string' || !decoded.header?.kid) {
      throw new UnauthorizedException('Malformed Apple identity token.');
    }

    const key = await this.resolveSigningKey(decoded.header.kid);

    let payload: jwt.JwtPayload;
    try {
      payload = jwt.verify(identityToken, key, {
        algorithms: ['RS256'],
        issuer: APPLE_ISSUER,
        audience: bundleId,
      }) as jwt.JwtPayload;
    } catch (err) {
      this.logger.warn(`Apple identity token rejected: ${(err as Error).message}`);
      throw new UnauthorizedException('Invalid Apple identity token.');
    }

    const expectedNonce = createHash('sha256').update(rawNonce).digest('hex');
    if (payload.nonce !== expectedNonce) {
      throw new UnauthorizedException('Apple sign-in could not be verified. Please try again.');
    }

    if (!payload.sub) {
      throw new UnauthorizedException('Apple identity token is missing a subject.');
    }

    return {
      sub: payload.sub,
      email: typeof payload['email'] === 'string' ? (payload['email'] as string) : undefined,
      emailVerified:
        payload['email_verified'] === true || payload['email_verified'] === 'true',
      isPrivateEmail:
        payload['is_private_email'] === true || payload['is_private_email'] === 'true',
    };
  }

  private async resolveSigningKey(kid: string): Promise<KeyObject> {
    let jwk = (await this.getKeys()).find((k) => k.kid === kid);
    if (!jwk) {
      // Key rotation — force one refresh before giving up.
      this.keyCache = null;
      jwk = (await this.getKeys()).find((k) => k.kid === kid);
    }
    if (!jwk) {
      throw new UnauthorizedException('Unknown Apple signing key.');
    }
    return createPublicKey({
      key: { kty: jwk.kty, n: jwk.n, e: jwk.e },
      format: 'jwk',
    });
  }

  private async getKeys(): Promise<AppleJwk[]> {
    if (this.keyCache && Date.now() - this.keyCache.fetchedAt < KEYS_TTL_MS) {
      return this.keyCache.keys;
    }
    // APPLE_JWKS_URL_OVERRIDE is a test-only hook for exercising the endpoint
    // against a mock JWKS without a real device — never set it in production.
    const url = process.env['APPLE_JWKS_URL_OVERRIDE'] || APPLE_KEYS_URL;
    const { data } = await axios.get<{ keys: AppleJwk[] }>(url, { timeout: 8000 });
    this.keyCache = { keys: data.keys, fetchedAt: Date.now() };
    return data.keys;
  }
}
