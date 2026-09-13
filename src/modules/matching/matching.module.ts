import { Module } from '@nestjs/common';
import { MatchingService } from './matching.service';
import { MatchingScheduler } from './matching.scheduler';
import { NotificationsModule } from '../notifications/notifications.module';
import { WebsocketsModule } from '../websockets/websockets.module';

@Module({
  imports: [NotificationsModule, WebsocketsModule],
  providers: [MatchingService, MatchingScheduler],
  exports: [MatchingService],
})
export class MatchingModule {}
