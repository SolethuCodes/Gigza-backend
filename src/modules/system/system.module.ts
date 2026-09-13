import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { SystemService } from './system.service';
import { SystemController } from './system.controller';
import { PublicConfigController } from './public-config.controller';
import { MaintenanceInterceptor } from './maintenance.interceptor';
import { SupportModule } from '../support/support.module';

@Module({
  imports: [SupportModule],
  controllers: [SystemController, PublicConfigController],
  providers: [
    SystemService,
    { provide: APP_INTERCEPTOR, useClass: MaintenanceInterceptor },
  ],
  exports: [SystemService],
})
export class SystemModule {}
