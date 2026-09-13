import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SystemService } from './system.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { PasswordChangeGuard } from '../../common/guards/password-change.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { CreateSnapshotDto, RestoreConfigDto, UpdateAppConfigDto } from './dto/update-app-config.dto';

@ApiTags('system')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard, PasswordChangeGuard)
@Roles('ADMIN')
@Controller({ path: 'admin/system', version: '1' })
export class SystemController {
  constructor(private readonly system: SystemService) {}

  @Get('overview')
  @Permissions('system.view')
  @ApiOperation({ summary: 'Live health, alerts and published app configuration' })
  getOverview() {
    return this.system.getOverview();
  }

  @Get('app-config')
  @Permissions('system.view')
  @ApiOperation({ summary: 'Current live app and website configuration' })
  getConfig() {
    return this.system.getAdminConfig();
  }

  @Patch('app-config')
  @Permissions('system.manage')
  @ApiOperation({ summary: 'Publish app/website configuration (creates an automatic backup)' })
  publish(@Body() body: UpdateAppConfigDto, @CurrentUser() user: AuthenticatedUser) {
    const { snapshotLabel, reason, ...patch } = body;
    return this.system.publish(patch as Record<string, unknown>, {
      id: user.id,
      isSuperAdmin: user.isSuperAdmin,
    }, { label: snapshotLabel, reason });
  }

  @Get('snapshots')
  @Permissions('system.view')
  @ApiOperation({ summary: 'List configuration restore points' })
  listSnapshots() {
    return this.system.listSnapshots();
  }

  @Post('snapshots')
  @Permissions('system.manage')
  @ApiOperation({ summary: 'Create a named restore point without publishing changes' })
  createSnapshot(@Body() body: CreateSnapshotDto, @CurrentUser() user: AuthenticatedUser) {
    return this.system.createSnapshot(user.id, body.label, body.reason);
  }

  @Post('snapshots/:id/restore')
  @Permissions('system.manage')
  @ApiOperation({ summary: 'Restore a previous live configuration' })
  restore(
    @Param('id') id: string,
    @Body() body: RestoreConfigDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.system.restore(id, { id: user.id, isSuperAdmin: user.isSuperAdmin }, body.reason);
  }
}
