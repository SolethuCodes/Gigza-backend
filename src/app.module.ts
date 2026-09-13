import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { WinstonModule } from 'nest-winston';
import * as winston from 'winston';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { ProvidersModule } from './modules/providers/providers.module';
import { CategoriesModule } from './modules/categories/categories.module';
import { ServicesModule } from './modules/services/services.module';
import { BookingsModule } from './modules/bookings/bookings.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { WalletModule } from './modules/wallet/wallet.module';
import { RatingsModule } from './modules/ratings/ratings.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { DisputesModule } from './modules/disputes/disputes.module';
import { AdminModule } from './modules/admin/admin.module';
import { SupportModule } from './modules/support/support.module';
import { UploadsModule } from './modules/uploads/uploads.module';
import { WebsocketsModule } from './modules/websockets/websockets.module';
import { MessagesModule } from './modules/messages/messages.module';
import { HealthModule } from './modules/health/health.module';
import { SumsubModule } from './modules/sumsub/sumsub.module';
import { DiditModule } from './modules/didit/didit.module';
import { SystemModule } from './modules/system/system.module';
import { PrismaModule } from './prisma/prisma.module';
import { AuditModule } from './common/audit/audit.module';
import { RedisModule } from './services/redis/redis.module';
import { EmailModule } from './services/email/email.module';
import { SmsModule } from './services/sms/sms.module';
import { PushModule } from './services/push/push.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import appConfig from './config/app.config';
import authConfig from './config/auth.config';
import databaseConfig from './config/database.config';
import paymentConfig from './config/payment.config';
import sumsubConfig from './config/sumsub.config';
import diditConfig from './config/didit.config';

const logDir = join(process.cwd(), 'logs');
if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true });

@Module({
  imports: [
    // Configuration
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig, authConfig, databaseConfig, paymentConfig, sumsubConfig, diditConfig],
      envFilePath: ['.env.local', '.env'],
    }),

    // Rate limiting
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => [
        {
          ttl: config.get('THROTTLE_TTL', 60000),
          limit: config.get('THROTTLE_LIMIT', 100),
        },
      ],
    }),

    // Cron jobs
    ScheduleModule.forRoot(),

    // Logging
    WinstonModule.forRoot({
      transports: [
        new winston.transports.Console({
          format: winston.format.combine(
            winston.format.timestamp(),
            winston.format.colorize(),
            winston.format.printf(({ timestamp, level, message, context }) =>
              `${timestamp} [${context}] ${level}: ${message}`,
            ),
          ),
        }),
        new winston.transports.File({
          filename: 'logs/error.log',
          level: 'error',
          format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
        }),
        new winston.transports.File({
          filename: 'logs/combined.log',
          format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
        }),
      ],
    }),

    // Infrastructure
    PrismaModule,
    AuditModule,
    RedisModule,
    EmailModule,
    SmsModule,
    PushModule,

    // Feature modules
    AuthModule,
    UsersModule,
    ProvidersModule,
    CategoriesModule,
    ServicesModule,
    BookingsModule,
    PaymentsModule,
    WalletModule,
    RatingsModule,
    NotificationsModule,
    DisputesModule,
    AdminModule,
    SupportModule,
    UploadsModule,
    WebsocketsModule,
    MessagesModule,
    HealthModule,
    SystemModule,
    // Kept registered (webhook route only — ProvidersModule no longer mints new
    // Sumsub tokens) so any applicant still mid-review through Sumsub at cutover
    // still gets their result recorded. Safe to remove once no such applicants
    // remain in UNDER_REVIEW from before the Didit migration.
    SumsubModule,
    DiditModule,
  ],
  providers: [HttpExceptionFilter],
})
export class AppModule {}
