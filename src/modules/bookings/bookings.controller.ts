import { Controller, Get, Post, Patch, Param, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiBody } from '@nestjs/swagger';
import { BookingsService } from './bookings.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { UpdateBookingStatusDto } from './dto/update-booking-status.dto';
import { CreateBookingDto } from './dto/create-booking.dto';
import { UpdateBookingDto } from './dto/update-booking.dto';
import { CompleteByQrDto } from './dto/complete-by-qr.dto';

@ApiTags('bookings')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller({ path: 'bookings', version: '1' })
export class BookingsController {
  constructor(private readonly bookings: BookingsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a booking from a service request' })
  create(@CurrentUser() user: AuthenticatedUser, @Body() body: CreateBookingDto) {
    return this.bookings.create(user.id, body);
  }

  @Get('my')
  @ApiOperation({ summary: 'Get all bookings for current user' })
  myBookings(@CurrentUser() user: AuthenticatedUser) {
    if (user.role === 'PROVIDER') return this.bookings.findForProvider(user.id);
    return this.bookings.findForUser(user.id);
  }

  @Post('complete-by-qr')
  @ApiOperation({ summary: 'Assigned provider scans the customer completion QR to finish the job and release payout' })
  @ApiBody({ type: CompleteByQrDto })
  completeByQr(@CurrentUser() user: AuthenticatedUser, @Body() body: CompleteByQrDto) {
    return this.bookings.completeByQr(user.id, body.token);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.bookings.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update booking location details' })
  @ApiBody({ type: UpdateBookingDto })
  update(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser, @Body() body: UpdateBookingDto) {
    return this.bookings.update(id, user.id, body);
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Update booking status (accept, start, cancel, decline). Completion is QR-only.' })
  updateStatus(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser, @Body() body: UpdateBookingStatusDto) {
    return this.bookings.updateStatus(id, user.id, body.status, body.reason ?? body.cancellationReason);
  }

  @Post(':id/completion-qr')
  @ApiOperation({ summary: 'Customer issues a short-lived completion QR for the assigned provider to scan' })
  issueCompletionQr(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.bookings.issueCompletionQr(id, user.id);
  }
}
