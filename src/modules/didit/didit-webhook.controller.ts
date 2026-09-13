import { BadRequestException, Body, Controller, Headers, HttpCode, HttpStatus, Logger, Post, Req } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';
import { ApiExcludeController } from '@nestjs/swagger';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '../../services/email/email.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RedisService } from '../../services/redis/redis.service';
import { Public } from '../../common/decorators/public.decorator';

type DiditStatus =
  | 'Not Started'
  | 'In Progress'
  | 'In Review'
  | 'Approved'
  | 'Declined'
  | 'Resubmitted'
  | 'Abandoned'
  | 'Expired'
  | 'Kyc Expired'
  | string;

interface DiditIdVerification {
  status?: string;
  comment?: string;
}

interface DiditDecision {
  id_verifications?: DiditIdVerification[];
  [key: string]: unknown;
}

/** See https://docs.didit.me/integration/webhooks */
interface DiditWebhookPayload {
  event_id: string;
  session_id: string;
  vendor_data?: string; // the provider.id we passed as `vendor_data` when creating the session
  status: DiditStatus;
  decision?: DiditDecision;
  resubmit_info?: { nodes_to_resubmit?: string[] };
}

const WEBHOOK_MAX_SKEW_SECONDS = 300;
// Dedupe window — comfortably longer than Didit's retry horizon, short enough not to bloat Redis.
const WEBHOOK_DEDUPE_TTL_SECONDS = 24 * 60 * 60;

function shortenFloats(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(shortenFloats);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, shortenFloats(v)]));
  }
  if (typeof value === 'number' && value % 1 === 0) return Math.trunc(value);
  return value;
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    return Object.keys(value as object)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = sortKeys((value as Record<string, unknown>)[key]);
        return acc;
      }, {});
  }
  return value;
}

@ApiExcludeController()
@Controller({ path: 'webhooks/didit', version: '1' })
export class DiditWebhookController {
  private readonly logger = new Logger(DiditWebhookController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly email: EmailService,
    private readonly notifications: NotificationsService,
    private readonly redis: RedisService,
  ) {}

  /**
   * Verifies X-Signature-V2: an HMAC-SHA256 over the canonicalized (key-sorted,
   * whole-float-shortened) JSON body — survives re-encoding better than a
   * raw-bytes digest, so it's computed from the parsed+re-canonicalized body
   * rather than req.rawBody directly (unlike Sumsub's x-payload-digest).
   */
  private verifySignature(raw: string, sigHeader: string | undefined): boolean {
    const secret = this.config.get<string>('didit.webhookSecret');
    if (!secret) {
      this.logger.error('DIDIT_WEBHOOK_SECRET is not configured — refusing to trust an unverifiable webhook');
      return false;
    }
    if (!sigHeader) return false;

    let canonical: string;
    try {
      canonical = JSON.stringify(sortKeys(shortenFloats(JSON.parse(raw))));
    } catch {
      return false;
    }

    const expected = createHmac('sha256', secret).update(canonical, 'utf8').digest('hex');
    const expectedBuf = Buffer.from(expected, 'hex');
    const actualBuf = Buffer.from(sigHeader, 'hex');
    if (expectedBuf.length !== actualBuf.length) return false;
    return timingSafeEqual(expectedBuf, actualBuf);
  }

  private extractRejectReason(decision?: DiditDecision): string | undefined {
    const failed = decision?.id_verifications?.find((c) => c?.comment);
    return failed?.comment;
  }

  @Public()
  @Post()
  @HttpCode(HttpStatus.OK)
  async handleWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Body() body: DiditWebhookPayload,
    @Headers('x-signature-v2') signature: string | undefined,
    @Headers('x-timestamp') timestampHeader: string | undefined,
  ) {
    const raw = req.rawBody?.toString('utf8') ?? '';

    const timestamp = Number(timestampHeader);
    if (!timestamp || Math.abs(Date.now() / 1000 - timestamp) > WEBHOOK_MAX_SKEW_SECONDS) {
      this.logger.warn(`Rejected Didit webhook with stale/missing X-Timestamp (event=${body?.event_id})`);
      throw new BadRequestException('Stale timestamp');
    }
    if (!this.verifySignature(raw, signature)) {
      this.logger.warn(`Rejected Didit webhook with invalid/missing signature (event=${body?.event_id})`);
      throw new BadRequestException('Invalid signature');
    }

    // Single-use / dedupe on event_id — type-aware Redis key, same prefixing convention as the rest of the app.
    const dedupeKey = `didit:webhook_event:${body.event_id}`;
    if (await this.redis.exists(dedupeKey)) {
      return { received: true };
    }
    await this.redis.set(dedupeKey, '1', WEBHOOK_DEDUPE_TTL_SECONDS);

    const providerId = body.vendor_data;
    if (!providerId) {
      this.logger.warn(`Didit webhook missing vendor_data (session=${body.session_id})`);
      return { received: true };
    }

    const provider = await this.prisma.provider.findUnique({ where: { id: providerId } });
    if (!provider) {
      this.logger.warn(`Didit webhook for unknown provider id=${providerId} (session=${body.session_id})`);
      return { received: true };
    }

    switch (body.status) {
      case 'Approved':
        await this.prisma.provider.update({
          where: { id: provider.id },
          data: {
            kycStatus: 'APPROVED',
            kycRejectionReason: null,
            kycReviewedAt: new Date(),
            kycReviewedBy: null,
            isAvailable: true,
            diditSessionId: body.session_id,
          },
        });
        this.logger.log(`Provider ${provider.id} KYC approved via Didit (session=${body.session_id})`);
        this.email.sendKycApproval(provider.email, provider.firstName, true).catch((error) => {
          this.logger.error(`KYC approval email failed for ${provider.email}`, error);
        });
        void this.notifications
          .send(provider.id, 'KYC_APPROVED', 'You’re verified', 'Your identity check passed — you can now accept paid jobs.', { type: 'kyc' }, 'provider')
          .catch(() => undefined);
        break;

      case 'Declined': {
        const rejectReason = this.extractRejectReason(body.decision);
        await this.prisma.provider.update({
          where: { id: provider.id },
          data: {
            kycStatus: 'REJECTED',
            kycRejectionReason: rejectReason ?? 'Identity verification failed',
            kycReviewedAt: new Date(),
            kycReviewedBy: null,
            diditSessionId: body.session_id,
          },
        });
        this.logger.log(`Provider ${provider.id} KYC rejected via Didit (session=${body.session_id})`);
        this.email.sendKycApproval(provider.email, provider.firstName, false, rejectReason).catch((error) => {
          this.logger.error(`KYC update email failed for ${provider.email}`, error);
        });
        void this.notifications
          .send(
            provider.id,
            'KYC_REJECTED',
            'Verification failed',
            `Your identity verification was declined: ${rejectReason ?? 'contact support for help'}.`,
            { type: 'kyc' },
            'provider',
          )
          .catch(() => undefined);
        break;
      }

      case 'In Review':
        if (provider.kycStatus === 'PENDING' || provider.kycStatus === 'REJECTED') {
          await this.prisma.provider.update({
            where: { id: provider.id },
            data: { kycStatus: 'UNDER_REVIEW', diditSessionId: body.session_id },
          });
          this.logger.log(`Provider ${provider.id} KYC marked under review via Didit`);
        }
        break;

      case 'Resubmitted':
        await this.prisma.provider.update({
          where: { id: provider.id },
          data: { kycStatus: 'PENDING', kycRejectionReason: null },
        });
        this.logger.log(
          `Provider ${provider.id} needs to resubmit KYC docs via Didit (nodes=${body.resubmit_info?.nodes_to_resubmit?.join(',') ?? 'unspecified'})`,
        );
        break;

      case 'Kyc Expired':
        // Prior approval aged out — reset so the provider can start a fresh session.
        await this.prisma.provider.update({ where: { id: provider.id }, data: { kycStatus: 'PENDING' } });
        this.logger.log(`Provider ${provider.id} Didit KYC expired — reset to PENDING for re-verification`);
        break;

      case 'In Progress':
      case 'Abandoned':
      case 'Expired':
      case 'Not Started':
        // Acknowledged, no status change (In Progress is already reflected optimistically at session creation).
        break;

      default:
        this.logger.warn(`Didit webhook with unrecognized status=${body.status} for provider ${provider.id}`);
    }

    return { received: true };
  }
}
