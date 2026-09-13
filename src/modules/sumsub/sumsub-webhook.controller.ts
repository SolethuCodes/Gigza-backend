import { BadRequestException, Body, Controller, Headers, HttpCode, HttpStatus, Logger, Post, Req } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';
import { ApiExcludeController } from '@nestjs/swagger';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '../../services/email/email.service';
import { NotificationsService } from '../notifications/notifications.service';
import { Public } from '../../common/decorators/public.decorator';

interface SumsubReviewResult {
  reviewAnswer: 'GREEN' | 'RED' | string;
  reviewRejectType?: 'RETRY' | 'FINAL' | string;
  rejectLabels?: string[];
  moderationComment?: string;
  clientComment?: string;
}

/** See https://docs.sumsub.com/docs/user-verification-webhooks */
interface SumsubWebhookPayload {
  type: string; // applicantReviewed, applicantPending, applicantCreated, ...
  applicantId?: string;
  externalUserId?: string; // the provider.id we passed as `userId` when generating the SDK token
  reviewResult?: SumsubReviewResult;
}

const DIGEST_ALG_TO_NODE: Record<string, string> = {
  HMAC_SHA256_HEX: 'sha256',
  HMAC_SHA512_HEX: 'sha512',
  HMAC_SHA1_HEX: 'sha1',
};

@ApiExcludeController()
@Controller({ path: 'webhooks/sumsub', version: '1' })
export class SumsubWebhookController {
  private readonly logger = new Logger(SumsubWebhookController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly email: EmailService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Verifies the `x-payload-digest` HMAC against the raw request bytes.
   * See https://docs.sumsub.com/docs/webhook-manager — the digest is computed
   * over the exact bytes Sumsub sent, so this must run against req.rawBody
   * (captured via `rawBody: true` in main.ts), not the re-serialized JSON body.
   */
  private verifySignature(rawBody: Buffer | undefined, digestHeader: string | undefined, algHeader: string | undefined): boolean {
    const secret = this.config.get<string>('sumsub.webhookSecret');
    if (!secret) {
      this.logger.error('SUMSUB_WEBHOOK_SECRET is not configured — refusing to trust an unverifiable webhook');
      return false;
    }
    if (!rawBody || !digestHeader || !algHeader) return false;

    const nodeAlg = DIGEST_ALG_TO_NODE[algHeader];
    if (!nodeAlg) {
      this.logger.warn(`Unrecognized x-payload-digest-alg: ${algHeader}`);
      return false;
    }

    const expected = createHmac(nodeAlg, secret).update(rawBody).digest('hex');
    const expectedBuf = Buffer.from(expected, 'hex');
    const actualBuf = Buffer.from(digestHeader, 'hex');
    if (expectedBuf.length !== actualBuf.length) return false;
    return timingSafeEqual(expectedBuf, actualBuf);
  }

  @Public()
  @Post()
  @HttpCode(HttpStatus.OK)
  async handleWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Body() body: SumsubWebhookPayload,
    @Headers('x-payload-digest') digest: string | undefined,
    @Headers('x-payload-digest-alg') digestAlg: string | undefined,
  ) {
    if (!this.verifySignature(req.rawBody, digest, digestAlg)) {
      this.logger.warn(`Rejected Sumsub webhook with invalid/missing signature (type=${body?.type})`);
      throw new BadRequestException('Invalid signature');
    }

    if (body.type !== 'applicantReviewed' && body.type !== 'applicantPending') {
      // applicantCreated / applicantOnHold etc. — acknowledged, no status change.
      return { received: true };
    }

    const providerId = body.externalUserId;
    if (!providerId) {
      this.logger.warn(`Sumsub ${body.type} webhook missing externalUserId (applicantId=${body.applicantId})`);
      return { received: true };
    }

    const provider = await this.prisma.provider.findUnique({ where: { id: providerId } });
    if (!provider) {
      this.logger.warn(`Sumsub webhook for unknown provider id=${providerId} (applicantId=${body.applicantId})`);
      return { received: true };
    }

    if (body.type === 'applicantPending') {
      if (provider.kycStatus === 'PENDING' || provider.kycStatus === 'REJECTED') {
        await this.prisma.provider.update({
          where: { id: provider.id },
          data: {
            kycStatus: 'UNDER_REVIEW',
            diditSessionId: body.applicantId ?? provider.diditSessionId,
          },
        });
        this.logger.log(`Provider ${provider.id} KYC marked under review via Sumsub pending webhook`);
      }
      return { received: true };
    }

    const result = body.reviewResult;
    const rejectReason = result?.moderationComment ?? result?.clientComment ?? result?.rejectLabels?.join(', ');

    if (result?.reviewAnswer === 'GREEN') {
      await this.prisma.provider.update({
        where: { id: provider.id },
        data: {
          kycStatus: 'APPROVED',
          kycRejectionReason: null,
          kycReviewedAt: new Date(),
          kycReviewedBy: null,
          isAvailable: true,
          diditSessionId: body.applicantId ?? provider.diditSessionId,
        },
      });
      this.logger.log(`Provider ${provider.id} KYC approved via Sumsub (applicantId=${body.applicantId})`);
      this.email.sendKycApproval(provider.email, provider.firstName, true).catch((error) => {
        this.logger.error(`KYC approval email failed for ${provider.email}`, error);
      });
      void this.notifications
        .send(
          provider.id,
          'KYC_APPROVED',
          'You’re verified',
          'Your identity check passed — you can now accept paid jobs.',
          { type: 'kyc' },
          'provider',
        )
        .catch(() => undefined);
    } else if (result?.reviewAnswer === 'RED') {
      // RETRY = the applicant can fix and resubmit through the SDK; FINAL = permanent rejection.
      const retryable = result.reviewRejectType === 'RETRY';
      await this.prisma.provider.update({
        where: { id: provider.id },
        data: {
          kycStatus: retryable ? 'PENDING' : 'REJECTED',
          kycRejectionReason: rejectReason ?? 'Identity verification failed',
          kycReviewedAt: new Date(),
          kycReviewedBy: null,
          diditSessionId: body.applicantId ?? provider.diditSessionId,
        },
      });
      this.logger.log(
        `Provider ${provider.id} KYC ${retryable ? 'needs retry' : 'rejected'} via Sumsub (applicantId=${body.applicantId}, labels=${result.rejectLabels?.join(',')})`,
      );
      this.email.sendKycApproval(provider.email, provider.firstName, false, rejectReason).catch((error) => {
        this.logger.error(`KYC update email failed for ${provider.email}`, error);
      });
      void this.notifications
        .send(
          provider.id,
          'KYC_REJECTED',
          retryable ? 'Verification needs another try' : 'Verification failed',
          retryable
            ? `We couldn't verify your identity: ${rejectReason ?? 'please resubmit your documents'}.`
            : `Your identity verification was declined: ${rejectReason ?? 'contact support for help'}.`,
          { type: 'kyc' },
          'provider',
        )
        .catch(() => undefined);
    } else {
      this.logger.warn(`Sumsub applicantReviewed with unrecognized reviewAnswer=${result?.reviewAnswer} for provider ${provider.id}`);
    }

    return { received: true };
  }
}
