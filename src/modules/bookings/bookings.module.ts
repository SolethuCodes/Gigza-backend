import { Module, forwardRef } from '@nestjs/common';
import { BookingsController } from './bookings.controller';
import { BookingsService } from './bookings.service';
import { BookingReminderScheduler } from './booking-reminder.scheduler';
import { WebsocketsModule } from '../websockets/websockets.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PaymentsModule } from '../payments/payments.module';

@Module({
  imports: [WebsocketsModule, NotificationsModule, forwardRef(() => PaymentsModule)],
  controllers: [BookingsController],
  providers: [BookingsService, BookingReminderScheduler],
  exports: [BookingsService],
})
export class BookingsModule {}
