import { Module } from '@nestjs/common';
import { SumsubService } from './sumsub.service';
import { SumsubWebhookController } from './sumsub-webhook.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [PrismaModule, NotificationsModule],
  controllers: [SumsubWebhookController],
  providers: [SumsubService],
  exports: [SumsubService],
})
export class SumsubModule {}
