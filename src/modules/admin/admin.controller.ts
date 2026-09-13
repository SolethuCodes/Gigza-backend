import { Controller, Get, Patch, Post, Param, Body, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { AdminService } from './admin.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { PasswordChangeGuard } from '../../common/guards/password-change.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { RequestKycApprovalDto, ConfirmKycApprovalDto } from './dto/kyc-approval.dto';

@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard, PasswordChangeGuard)
@Roles('ADMIN')
@Controller({ path: 'admin', version: '1' })
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('dashboard/stats')
  @ApiOperation({ summary: 'Landing-page dashboard stats' })
  getDashboardStats() { return this.admin.getDashboardStats(); }

  @Get('users')
  @Permissions('users.view')
  @ApiOperation({ summary: 'List all users with search & pagination (FR-M1)' })
  getUsers(
    @Query('page') page = 1,
    @Query('limit') limit = 20,
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('role') role?: string,
  ) {
    return this.admin.getUsers(+page, +limit, search, status, role);
  }

  @Get('users/:id')
  @Permissions('users.view')
  @ApiOperation({ summary: 'User detail' })
  getUserDetail(@Param('id') id: string) { return this.admin.getUserDetail(id); }

  @Get('providers')
  @Permissions('providers.view')
  @ApiOperation({ summary: 'List all providers with search & pagination (FR-M1)' })
  getProviders(
    @Query('page') page = 1,
    @Query('limit') limit = 20,
    @Query('search') search?: string,
    @Query('kycStatus') kycStatus?: string,
    @Query('status') status?: string,
  ) {
    return this.admin.getProviders(+page, +limit, search, kycStatus, status);
  }

  @Get('providers/:id')
  @Permissions('providers.view')
  @ApiOperation({ summary: 'Provider detail' })
  getProviderDetail(@Param('id') id: string) { return this.admin.getProviderDetail(id); }

  @Patch('users/:id/suspend')
  @Permissions('users.manage')
  @ApiOperation({ summary: 'Suspend or ban a user (FR-M5)' })
  suspendUser(@Param('id') id: string, @CurrentUser() u: AuthenticatedUser, @Body() body: { reason: string }) { return this.admin.suspendUser(id, u.id, body.reason); }

  @Patch('users/:id/unsuspend')
  @Permissions('users.manage')
  unsuspendUser(@Param('id') id: string, @CurrentUser() u: AuthenticatedUser) { return this.admin.unsuspendUser(id, u.id); }

  @Patch('providers/:id/suspend')
  @Permissions('providers.manage')
  @ApiOperation({ summary: 'Suspend or ban a provider (FR-M5)' })
  suspendProvider(@Param('id') id: string, @CurrentUser() u: AuthenticatedUser, @Body() body: { reason: string }) { return this.admin.suspendProvider(id, u.id, body.reason); }

  @Patch('providers/:id/unsuspend')
  @Permissions('providers.manage')
  unsuspendProvider(@Param('id') id: string, @CurrentUser() u: AuthenticatedUser) { return this.admin.unsuspendProvider(id, u.id); }

  @Post('providers/:id/kyc/approve/request')
  @Permissions('providers.verify')
  @ApiOperation({ summary: 'KYC approval step 1: re-enter password + notes, emails an OTP to the admin' })
  requestKycApproval(
    @Param('id') id: string,
    @CurrentUser() u: AuthenticatedUser,
    @Body() body: RequestKycApprovalDto,
  ) {
    return this.admin.requestProviderKycApproval(u.id, body.password, id, body.notes);
  }

  @Post('providers/:id/kyc/approve/confirm')
  @Permissions('providers.verify')
  @ApiOperation({ summary: 'KYC approval step 2: confirm the OTP to mark the provider verified' })
  confirmKycApproval(
    @Param('id') id: string,
    @CurrentUser() u: AuthenticatedUser,
    @Body() body: ConfirmKycApprovalDto,
  ) {
    return this.admin.confirmProviderKycApproval(u.id, id, body.code);
  }

  @Get('bookings')
  @Permissions('bookings.view')
  @ApiOperation({ summary: 'Admin-wide booking list' })
  getBookings(
    @Query('page') page = 1,
    @Query('limit') limit = 20,
    @Query('status') status?: string,
    @Query('search') search?: string,
  ) {
    return this.admin.getBookings(+page, +limit, status, search);
  }

  @Get('bookings/analytics')
  @Permissions('bookings.view', 'analytics.view')
  @ApiOperation({ summary: 'Booking counts by status and per-day' })
  getBookingAnalytics() { return this.admin.getBookingAnalytics(); }

  @Get('bookings/:id')
  @Permissions('bookings.view')
  @ApiOperation({ summary: 'Booking detail' })
  getBookingDetail(@Param('id') id: string) { return this.admin.getBookingDetail(id); }

  @Get('activity')
  @Permissions('audit.view', 'users.view', 'providers.view', 'bookings.view')
  @ApiOperation({ summary: 'Investigation timeline for a user, provider, or booking' })
  getActivity(
    @Query('userId') userId?: string,
    @Query('providerId') providerId?: string,
    @Query('bookingId') bookingId?: string,
    @Query('page') page = 1,
    @Query('limit') limit = 80,
  ) {
    return this.admin.getSubjectActivity({ userId, providerId, bookingId, page: +page, limit: +limit });
  }

  @Get('transactions')
  @Permissions('payments.view')
  @ApiOperation({ summary: 'Admin-wide transaction/payment list' })
  getTransactions(
    @Query('page') page = 1,
    @Query('limit') limit = 20,
    @Query('status') status?: string,
    @Query('search') search?: string,
  ) {
    return this.admin.getTransactions(+page, +limit, status, search);
  }

  @Get('transactions/:id')
  @Permissions('payments.view')
  @ApiOperation({ summary: 'Payment / invoice detail' })
  getTransactionDetail(@Param('id') id: string) {
    return this.admin.getTransactionDetail(id);
  }

  @Get('withdrawals')
  @Permissions('payments.withdrawals', 'payments.view')
  @ApiOperation({ summary: 'Full withdrawal history, filterable by status' })
  getWithdrawals(@Query('page') page = 1, @Query('limit') limit = 20, @Query('status') status?: string) {
    return this.admin.getWithdrawals(+page, +limit, status);
  }

  @Get('withdrawals/pending')
  @Permissions('payments.withdrawals')
  @ApiOperation({ summary: 'Get pending withdrawal requests (FR-M4)' })
  getPendingWithdrawals() { return this.admin.getPendingWithdrawals(); }

  @Patch('withdrawals/:id/approve')
  @Permissions('payments.withdrawals')
  approveWithdrawal(@Param('id') id: string, @CurrentUser() u: AuthenticatedUser) { return this.admin.approveWithdrawal(id, u.id); }

  @Patch('withdrawals/:id/reject')
  @Permissions('payments.withdrawals')
  rejectWithdrawal(@Param('id') id: string, @CurrentUser() u: AuthenticatedUser, @Body() body: { reason: string }) { return this.admin.rejectWithdrawal(id, u.id, body.reason); }

  @Get('settings')
  @Permissions('settings.view')
  @ApiOperation({ summary: 'Get admin settings (singleton)' })
  getSettings() { return this.admin.getSettings(); }

  @Patch('settings')
  @Permissions('settings.update')
  @ApiOperation({ summary: 'Update admin settings (partial, per-tab payload)' })
  updateSettings(@Body() body: Record<string, unknown>, @CurrentUser() u: AuthenticatedUser) {
    return this.admin.updateSettings(body, u.id);
  }

  @Post('settings/test-email')
  @Permissions('settings.update')
  @ApiOperation({ summary: 'Send a test email using saved SMTP settings' })
  testEmail(@Body() body: { to?: string }, @CurrentUser() u: AuthenticatedUser) {
    return this.admin.sendTestEmail(body.to || u.email);
  }

  @Post('settings/test-sms')
  @Permissions('settings.update')
  @ApiOperation({ summary: 'Send a test SMS using the configured provider' })
  testSms(@Body() body: { phone?: string }, @CurrentUser() u: AuthenticatedUser) {
    return this.admin.sendTestSms(body.phone || u.phone);
  }

  @Get('reports/financial')
  @Permissions('analytics.view', 'payments.view')
  @ApiOperation({ summary: 'Financial reports & analytics (FR-M6)' })
  getFinancialSummary() { return this.admin.getFinancialSummary(); }

  @Get('reports/provider-performance')
  @Permissions('analytics.view')
  @ApiOperation({ summary: 'Provider performance leaderboard' })
  getProviderPerformanceReport(@Query('page') page = 1, @Query('limit') limit = 20) {
    return this.admin.getProviderPerformanceReport(+page, +limit);
  }

  @Get('analytics/bookings')
  @Permissions('analytics.view')
  @ApiOperation({ summary: 'Bookings over time, by status' })
  getBookingsAnalytics(@Query('granularity') granularity: 'day' | 'month' = 'day') {
    return this.admin.getBookingsAnalytics(granularity);
  }

  @Get('analytics/financial')
  @Permissions('analytics.view')
  @ApiOperation({ summary: 'Revenue/commission over time' })
  getFinancialAnalytics(@Query('granularity') granularity: 'day' | 'month' = 'month') {
    return this.admin.getFinancialAnalytics(granularity);
  }

  @Get('analytics/users')
  @Permissions('analytics.view')
  @ApiOperation({ summary: 'Signups over time, role/ban breakdown' })
  getUserAnalytics() { return this.admin.getUserAnalytics(); }
}
