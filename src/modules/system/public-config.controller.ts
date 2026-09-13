import { Body, Controller, Get, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { SystemService } from './system.service';
import { SupportService } from '../support/support.service';

@ApiTags('public')
@Controller({ path: 'public', version: '1' })
export class PublicConfigController {
  constructor(
    private readonly system: SystemService,
    private readonly support: SupportService,
  ) {}

  @Public()
  @Get('app-config')
  @ApiOperation({ summary: 'Published branding, help, legal and maintenance config for apps' })
  getConfig() {
    return this.system.getPublicConfig();
  }

  @Public()
  @Post('client-errors')
  @ApiOperation({ summary: 'Mobile Notify — report a client error to the admin console' })
  reportClientError(
    @Req() request: Request & { user?: { id?: string } },
    @Body() body: {
      type?: string;
      message?: string;
      event?: string;
      screen?: string;
      stack?: string;
      platform?: string;
      appVersion?: string;
      statusCode?: number;
      userId?: string;
    },
  ) {
    return this.support.reportClientError({
      ...body,
      userId: request.user?.id || body.userId,
    });
  }
}
