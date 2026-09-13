import { Module } from '@nestjs/common';
import { DiditService } from './didit.service';
import { DiditWebhookController } from './didit-webhook.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [PrismaModule, NotificationsModule],
  controllers: [DiditWebhookController],
  providers: [DiditService],
  exports: [DiditService],
})
export class DiditModule {}
