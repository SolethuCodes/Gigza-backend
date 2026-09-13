import { BadRequestException, Body, Controller, Headers, HttpCode, HttpStatus, Logger, Post, Req } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { ApiExcludeController } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { WalletService } from './wallet.service';

@ApiExcludeController()
@Controller({ path: 'webhooks/flutterwave', version: '1' })
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);

  constructor(private readonly wallet: WalletService) {}

  @Public()
  @Post()
  @HttpCode(HttpStatus.OK)
  async handleFlutterwaveWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Body() body: any,
    @Headers('flutterwave-signature') flutterwaveSignature?: string,
    @Headers('x-flw-signature') flwSignature?: string,
    @Headers('verif-hash') verifHash?: string,
  ) {
    const parsedBody = this.parseBody(body);
    const rawBody = req.rawBody ?? Buffer.from(JSON.stringify(parsedBody ?? {}));
    const signature = flutterwaveSignature ?? flwSignature ?? verifHash;

    if (!signature) {
      this.logger.warn('Flutterwave webhook missing signature header');
      throw new BadRequestException('Missing Flutterwave signature');
    }

    return this.wallet.handleFlutterwaveWebhook(rawBody, signature, parsedBody);
  }

  private parseBody(body: any) {
    if (Buffer.isBuffer(body)) {
      try {
        return JSON.parse(body.toString('utf8'));
      } catch {
        return { raw: body.toString('utf8') };
      }
    }
    if (typeof body === 'string') {
      try {
        return JSON.parse(body);
      } catch {
        return { raw: body };
      }
    }
    return body ?? {};
  }
}
