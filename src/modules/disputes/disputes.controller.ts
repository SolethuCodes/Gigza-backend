import { Controller, Post, Get, Patch, Param, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { DisputesService } from './disputes.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
@ApiTags('disputes')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller({ path: 'disputes', version: '1' })
export class DisputesController {
  constructor(private readonly disputes: DisputesService) {}
  @Post() create(@CurrentUser() u: AuthenticatedUser, @Body() body: { bookingId: string; type: string; description: string; evidenceUrls?: string[] }) { return this.disputes.create(u.id, body); }

  @Get()
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'SUPPORT')
  findAll() { return this.disputes.findAll(true); }

  @Get(':id')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'SUPPORT')
  findOne(@Param('id') id: string) { return this.disputes.findOne(id); }

  @Patch(':id/resolve')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'SUPPORT')
  resolve(@Param('id') id: string, @CurrentUser() u: AuthenticatedUser, @Body() body: { resolution: string }) { return this.disputes.resolve(id, u.id, body.resolution); }
}
