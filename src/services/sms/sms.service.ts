import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private africastalking: any;

  constructor(private readonly config: ConfigService) {
    const apiKey = config.get<string>('AFRICAS_TALKING_API_KEY');
    const username = config.get<string>('AFRICAS_TALKING_USERNAME', 'sandbox');

    if (apiKey) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const AT = require('africastalking');
      const atClient = AT({ apiKey, username });
      this.africastalking = atClient.SMS;
    }
  }

  async sendOtp(phone: string, code: string) {
    const message = `Your E-RRANDS verification code is: ${code}. Valid for 10 minutes. Do not share this code.`;

    if (!this.africastalking) {
      // Development fallback — log OTP to console
      this.logger.warn(`[DEV SMS] OTP for ${phone}: ${code}`);
      return;
    }

    try {
      await this.africastalking.send({ to: [phone], message, from: 'E-RRANDS' });
      this.logger.log(`OTP SMS sent to ${phone}`);
    } catch (error) {
      this.logger.error(`Failed to send SMS to ${phone}`, error);
      throw error;
    }
  }

  async sendBookingNotification(phone: string, message: string) {
    if (!this.africastalking) {
      this.logger.warn(`[DEV SMS] Notification for ${phone}: ${message}`);
      return;
    }

    try {
      await this.africastalking.send({ to: [phone], message, from: 'E-RRANDS' });
    } catch (error) {
      this.logger.error(`Failed to send SMS notification to ${phone}`, error);
    }
  }
}
