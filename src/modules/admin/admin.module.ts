import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AccessControlController } from './access-control.controller';
import { AccessControlService } from './access-control.service';
import { WalletModule } from '../wallet/wallet.module';
import { EmailModule } from '../../services/email/email.module';
import { SmsModule } from '../../services/sms/sms.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [WalletModule, EmailModule, SmsModule, NotificationsModule],
  controllers: [AdminController, AccessControlController],
  providers: [AdminService, AccessControlService],
  exports: [AdminService, AccessControlService],
})
export class AdminModule {}
