import { BadGatewayException, Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'crypto';

export interface GenerateAccessTokenParams {
  /** Our own provider id — bound to the Sumsub applicant as externalUserId; also how the webhook is correlated back. */
  userId: string;
  email?: string;
  phone?: string;
  ttlInSecs?: number;
}

/**
 * Client for Sumsub's REST API (https://docs.sumsub.com). Used only to mint a
 * short-lived SDK access token for the mobile app — the actual document
 * capture/liveness flow runs inside Sumsub's native Mobile SDK on-device.
 * Verification results arrive later via webhook (see SumsubWebhookController).
 *
 * Auth: every request is signed with HMAC-SHA256 over
 * `timestamp + METHOD + requestPath(+query) + body`, using the account's
 * secret key. See https://docs.sumsub.com/reference/authentication
 */
@Injectable()
export class SumsubService {
  private readonly logger = new Logger(SumsubService.name);

  constructor(private readonly config: ConfigService) {}

  private get baseUrl(): string {
    return this.config.get<string>('sumsub.baseUrl') ?? 'https://api.sumsub.com';
  }

  private get appToken(): string {
    const token = this.config.get<string>('sumsub.appToken');
    if (!token) throw new InternalServerErrorException('SUMSUB_APP_TOKEN is not configured');
    return token;
  }

  private get secretKey(): string {
    const key = this.config.get<string>('sumsub.secretKey');
    if (!key) throw new InternalServerErrorException('SUMSUB_SECRET_KEY is not configured');
    return key;
  }

  /** Builds the X-App-* signed headers required on every Sumsub API call. */
  private signedHeaders(method: string, path: string, body = ''): Record<string, string> {
    const ts = Math.floor(Date.now() / 1000);
    const signature = createHmac('sha256', this.secretKey)
      .update(`${ts}${method.toUpperCase()}${path}${body}`)
      .digest('hex');

    return {
      'X-App-Token': this.appToken,
      'X-App-Access-Sig': signature,
      'X-App-Access-Ts': String(ts),
    };
  }

  /**
   * POST /resources/accessTokens/sdk — mints a token the mobile SDK uses to
   * launch the verification flow. Implicitly creates the Sumsub applicant
   * (bound to `userId` as externalUserId) on first call if one doesn't exist yet.
   */
  async generateAccessToken(params: GenerateAccessTokenParams): Promise<{ token: string; userId: string; sandbox: boolean }> {
    const levelName = this.config.get<string>('sumsub.levelName');
    if (!levelName) {
      throw new InternalServerErrorException('SUMSUB_LEVEL_NAME is not configured');
    }

    const path = '/resources/accessTokens/sdk';
    const body = JSON.stringify({
      userId: params.userId,
      levelName,
      ttlInSecs: params.ttlInSecs ?? 600,
      ...(params.email || params.phone
        ? {
            applicantIdentifiers: {
              ...(params.email ? { email: params.email } : {}),
              ...(params.phone ? { phone: params.phone } : {}),
            },
          }
        : {}),
    });

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...this.signedHeaders('POST', path, body),
        },
        body,
      });
    } catch (err) {
      this.logger.error(`Sumsub /resources/accessTokens/sdk network error: ${(err as Error).message}`);
      throw new BadGatewayException('Could not reach Sumsub');
    }

    let data = (await response.json().catch(() => null)) as { token?: string; userId?: string; description?: string; code?: number } | null;

    // Older Sumsub accounts still use query-string token minting.
    if (!response.ok || typeof data?.token !== 'string') {
      this.logger.warn(`Sumsub /resources/accessTokens/sdk failed (${response.status}): ${JSON.stringify(data)}`);
      const fallbackPath = `/resources/accessTokens?userId=${encodeURIComponent(params.userId)}&levelName=${encodeURIComponent(levelName)}&ttlInSecs=${encodeURIComponent(String(params.ttlInSecs ?? 600))}`;
      try {
        response = await fetch(`${this.baseUrl}${fallbackPath}`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...this.signedHeaders('POST', fallbackPath, ''),
          },
          body: '',
        });
      } catch (err) {
        this.logger.error(`Sumsub /resources/accessTokens network error: ${(err as Error).message}`);
        throw new BadGatewayException('Could not reach Sumsub');
      }
      data = (await response.json().catch(() => null)) as { token?: string; userId?: string; description?: string } | null;
    }

    if (!response.ok || typeof data?.token !== 'string') {
      this.logger.error(`Sumsub access token failed (${response.status}): ${JSON.stringify(data)}`);
      throw new BadGatewayException(data?.description ?? 'Sumsub rejected the access token request. Confirm SUMSUB_LEVEL_NAME matches a verification level in the Sumsub dashboard.');
    }

    return {
      token: data.token,
      userId: data.userId ?? params.userId,
      // The mobile SDK must be pointed at a different host (test-api.sumsub.com)
      // for sandbox tokens — sbx-prefixed app tokens are how Sumsub marks that.
      // See @sumsub/react-native-mobilesdk-module's Builder.onTestEnv().
      sandbox: this.appToken.startsWith('sbx:'),
    };
  }
}
