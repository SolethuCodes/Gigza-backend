import { BadGatewayException, Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface CreateSessionParams {
  /** Our own provider id — passed as `vendor_data`; also how the webhook is correlated back. */
  providerId: string;
  callback?: string;
}

export interface DiditSession {
  sessionId: string;
  sessionToken: string;
  /** Hosted verification page (verify.didit.me) — used by the redirect/iframe/webview patterns. */
  url: string;
}

/**
 * Client for Didit's Verification API (https://docs.didit.me). Used only to
 * create a short-lived verification session for the mobile app — the actual
 * document capture/liveness flow runs inside Didit's native Mobile SDK (or
 * the hosted page at verify.didit.me) on-device. Verification results arrive
 * later via webhook (see DiditWebhookController).
 *
 * Auth: every request carries `x-api-key: DIDIT_API_KEY`.
 */
@Injectable()
export class DiditService {
  private readonly logger = new Logger(DiditService.name);

  constructor(private readonly config: ConfigService) {}

  private get baseUrl(): string {
    return this.config.get<string>('didit.verificationBaseUrl') ?? 'https://verification.didit.me';
  }

  private get apiKey(): string {
    const key = this.config.get<string>('didit.apiKey');
    if (!key) throw new InternalServerErrorException('DIDIT_API_KEY is not configured');
    return key;
  }

  private get workflowId(): string {
    const id = this.config.get<string>('didit.workflowId');
    if (!id) throw new InternalServerErrorException('DIDIT_WORKFLOW_ID is not configured');
    return id;
  }

  /**
   * POST /v3/session/ — creates a verification session bound to `vendor_data`
   * (our provider id). Reusing the same vendor_data while a session is still
   * unfinished returns the existing session rather than creating a duplicate.
   */
  async createSession(params: CreateSessionParams): Promise<DiditSession> {
    const body = JSON.stringify({
      workflow_id: this.workflowId,
      vendor_data: params.providerId,
      callback: params.callback ?? this.config.get<string>('didit.callbackUrl'),
    });

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/v3/session/`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': this.apiKey },
        body,
      });
    } catch (err) {
      this.logger.error(`Didit /v3/session/ network error: ${(err as Error).message}`);
      throw new BadGatewayException('Could not reach Didit');
    }

    const data = (await response.json().catch(() => null)) as
      | { session_id?: string; session_token?: string; url?: string; detail?: string }
      | null;

    if (!response.ok || !data?.session_id || !data.session_token || !data.url) {
      this.logger.error(`Didit session creation failed (${response.status}): ${JSON.stringify(data)}`);
      throw new BadGatewayException(
        data?.detail ?? 'Didit rejected the session request. Confirm DIDIT_WORKFLOW_ID matches a workflow that exists on the account.',
      );
    }

    return { sessionId: data.session_id, sessionToken: data.session_token, url: data.url };
  }
}
