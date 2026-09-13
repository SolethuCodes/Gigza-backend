import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AccessControlService } from './access-control.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { PasswordChangeGuard } from '../../common/guards/password-change.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import {
  CreateAdminRoleDto,
  InviteAdminDto,
  UpdateAdminRoleDto,
  UpdateStaffDto,
} from './dto/access-control.dto';

@ApiTags('admin-access')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard, PasswordChangeGuard)
@Roles('ADMIN')
@Controller({ path: 'admin', version: '1' })
export class AccessControlController {
  constructor(private readonly access: AccessControlService) {}

  @Get('permissions/catalog')
  @Permissions('access.view', 'access.manage')
  @ApiOperation({ summary: 'Permission catalog for role builder' })
  catalog() {
    return this.access.catalog();
  }

  @Get('roles')
  @Permissions('access.view', 'access.manage')
  listRoles() {
    return this.access.listRoles();
  }

  @Post('roles')
  @Permissions('access.manage')
  createRole(@Body() dto: CreateAdminRoleDto, @CurrentUser() user: AuthenticatedUser) {
    return this.access.createRole(dto, user.id);
  }

  @Patch('roles/:id')
  @Permissions('access.manage')
  updateRole(@Param('id') id: string, @Body() dto: UpdateAdminRoleDto, @CurrentUser() user: AuthenticatedUser) {
    return this.access.updateRole(id, dto, user.id);
  }

  @Delete('roles/:id')
  @Permissions('access.manage')
  deleteRole(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.access.deleteRole(id, user.id);
  }

  @Get('staff')
  @Permissions('access.view', 'access.manage')
  listStaff(
    @Query('page') page = 1,
    @Query('limit') limit = 20,
    @Query('search') search?: string,
    @Query('status') status?: string,
  ) {
    return this.access.listStaff(+page, +limit, search, status);
  }

  @Post('staff')
  @Permissions('access.manage')
  inviteStaff(@Body() dto: InviteAdminDto, @CurrentUser() user: AuthenticatedUser) {
    return this.access.inviteStaff(dto, user.id);
  }

  @Get('staff/:id')
  @Permissions('access.view', 'access.manage')
  getStaff(@Param('id') id: string) {
    return this.access.getStaff(id);
  }

  @Patch('staff/:id')
  @Permissions('access.manage')
  updateStaff(@Param('id') id: string, @Body() dto: UpdateStaffDto, @CurrentUser() user: AuthenticatedUser) {
    return this.access.updateStaff(id, dto, user.id);
  }

  @Patch('staff/:id/disable')
  @Permissions('access.manage')
  disableStaff(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser, @Body() body: { reason?: string }) {
    return this.access.disableStaff(id, user.id, body?.reason);
  }

  @Patch('staff/:id/enable')
  @Permissions('access.manage')
  enableStaff(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.access.enableStaff(id, user.id);
  }

  @Post('staff/:id/reveal-otp')
  @Permissions('access.manage')
  revealOtp(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.access.revealOneTimePassword(id, user.id);
  }

  @Get('staff/:id/activity')
  @Permissions('access.view', 'audit.view')
  staffActivity(
    @Param('id') id: string,
    @Query('page') page = 1,
    @Query('limit') limit = 80,
  ) {
    return this.access.getStaffActivity(id, +page, +limit);
  }

  @Get('audit-logs')
  @Permissions('audit.view')
  auditLogs(
    @Query('scope') scope: 'admin' | 'client' | 'all' = 'all',
    @Query('page') page = 1,
    @Query('limit') limit = 30,
    @Query('search') search?: string,
  ) {
    return this.access.getAuditLogs(scope, +page, +limit, search);
  }
}
