import { Controller, Get, Post, Patch, Param, Body, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { SupportService } from './support.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';

@ApiTags('support')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPPORT', 'ADMIN')
@Controller({ path: 'support', version: '1' })
export class SupportController {
  constructor(private readonly support: SupportService) {}

  @Get('activity-logs')
  @ApiOperation({ summary: 'Activity logs (FR-S2)' })
  getLogs(
    @Query('page') page = 1,
    @Query('limit') limit = 50,
    @Query('search') search?: string,
    @Query('action') action?: string,
  ) {
    return this.support.getActivityLogs(+page, +limit, search, action);
  }

  @Get('error-logs')
  @ApiOperation({ summary: 'Error & bug tracking (FR-S3)' })
  getErrors(
    @Query('page') page = 1,
    @Query('resolved') resolved?: string,
    @Query('context') context?: string,
    @Query('search') search?: string,
  ) {
    return this.support.getErrorLogs(+page, { resolved, context, search });
  }

  @Patch('error-logs/:id/resolve')
  @ApiOperation({ summary: 'Mark an error log as resolved' })
  resolveError(@Param('id') id: string) {
    return this.support.resolveError(id);
  }

  @Get('alerts')
  @ApiOperation({ summary: 'System alerts (FR-S6)' })
  getAlerts() {
    return this.support.getSystemAlerts();
  }

  @Post('alerts')
  createAlert(@Body() body: { type: string; severity: string; title: string; description: string }) {
    return this.support.createAlert(body.type, body.severity, body.title, body.description);
  }

  @Patch('alerts/:id/resolve')
  resolveAlert(@Param('id') id: string, @CurrentUser() u: AuthenticatedUser) {
    return this.support.resolveAlert(id, u.id);
  }

  @Get('tickets/stats')
  @ApiOperation({ summary: 'Ticket queue counts' })
  getTicketStats() {
    return this.support.getTicketStats();
  }

  @Get('tickets')
  @ApiOperation({ summary: 'List support tickets' })
  getTickets(
    @Query('page') page = 1,
    @Query('limit') limit = 20,
    @Query('status') status?: string,
    @Query('priority') priority?: string,
    @Query('category') category?: string,
    @Query('search') search?: string,
  ) {
    return this.support.getTickets(+page, +limit, { status, priority, category, search });
  }

  @Get('tickets/:id')
  @ApiOperation({ summary: 'Ticket detail with full message thread' })
  getTicketDetail(@Param('id') id: string) {
    return this.support.getTicketDetail(id);
  }

  @Patch('tickets/:id')
  @ApiOperation({ summary: 'Update ticket status, priority, assignment or resolution' })
  updateTicket(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { status?: string; priority?: string; assignedToId?: string; assignedAdminId?: string; resolution?: string; claim?: boolean },
  ) {
    const payload = { ...body };
    if (body.claim) {
      if (user.type === 'admin') payload.assignedAdminId = user.id;
      else payload.assignedToId = user.id;
      if (!payload.status) payload.status = 'IN_PROGRESS';
    }
    return this.support.updateTicket(id, payload, { id: user.id, type: user.type });
  }

  @Post('tickets/:id/messages')
  @ApiOperation({ summary: 'Append a public reply or internal note' })
  addTicketMessage(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { body: string; isInternal?: boolean },
  ) {
    return this.support.addTicketMessage(id, { id: user.id, type: user.type }, body.body, body.isInternal ?? false);
  }
}
