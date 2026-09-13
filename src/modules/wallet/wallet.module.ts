import { Module } from '@nestjs/common';
import { WalletController } from './wallet.controller';
import { WalletService } from './wallet.service';

import { WebhooksController } from './webhooks.controller';

@Module({
  controllers: [WalletController, WebhooksController],
  providers: [WalletService],
  exports: [WalletService],
})
export class WalletModule {}
