import { Controller, Get, Patch, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { NotificationsService } from './notifications.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';

@ApiTags('notifications')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller({ path: 'notifications', version: '1' })
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}
  @Get() @ApiOperation({ summary: 'Get notifications for current user' }) getAll(@CurrentUser() u: AuthenticatedUser) { return this.notifications.getForUser(u.id, u.type); }
  @Patch(':id/read') markRead(@Param('id') id: string, @CurrentUser() u: AuthenticatedUser) { return this.notifications.markRead(id, u.id, u.type); }
  @Patch('read-all') markAllRead(@CurrentUser() u: AuthenticatedUser) { return this.notifications.markAllRead(u.id, u.type); }
}
