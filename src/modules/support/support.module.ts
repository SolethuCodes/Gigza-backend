import { Module } from '@nestjs/common';
import { SupportController } from './support.controller';
import { SupportUserController } from './support-user.controller';
import { SupportService } from './support.service';
import { NotificationsModule } from '../notifications/notifications.module';
@Module({
  imports: [NotificationsModule],
  controllers: [SupportController, SupportUserController],
  providers: [SupportService],
  exports: [SupportService],
})
export class SupportModule {}
