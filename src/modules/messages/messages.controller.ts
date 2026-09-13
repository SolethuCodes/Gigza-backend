import { Controller, Get, Post, Patch, Param, Body, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { MessagesService } from './messages.service';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CreateMessageDto } from './dto';
import { SenderType } from '@prisma/client';

@ApiTags('messages')
@Controller('bookings')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class MessagesController {
  constructor(private messages: MessagesService) {}

  @Get('my/messages')
  @ApiOperation({ summary: 'Get all conversations for current user (customer)' })
  @ApiQuery({ name: 'status', required: false, type: String })
  getMyConversations(@CurrentUser() user: AuthenticatedUser, @Query('status') status?: string) {
    return this.messages.getUserConversations(user.id, status);
  }

  @Get(':bookingId/messages')
  @ApiOperation({ summary: 'Get all messages for a booking' })
  getBookingMessages(@CurrentUser() user: AuthenticatedUser, @Param('bookingId') bookingId: string) {
    const senderType = user.role === 'USER' ? SenderType.USER : SenderType.PROVIDER;
    return this.messages.getBookingMessages(bookingId, user.id, senderType);
  }

  @Post(':bookingId/messages')
  @ApiOperation({ summary: 'Send a new message in a booking conversation' })
  createMessage(
    @CurrentUser() user: AuthenticatedUser,
    @Param('bookingId') bookingId: string,
    @Body() dto: CreateMessageDto,
  ) {
    const senderType = user.role === 'USER' ? SenderType.USER : SenderType.PROVIDER;
    return this.messages.createMessage(bookingId, user.id, senderType, dto);
  }

  @Patch(':bookingId/messages/read')
  @ApiOperation({ summary: 'Mark all messages as read in a booking conversation' })
  markAsRead(@CurrentUser() user: AuthenticatedUser, @Param('bookingId') bookingId: string) {
    const senderType = user.role === 'USER' ? SenderType.USER : SenderType.PROVIDER;
    return this.messages.markMessagesAsRead(bookingId, user.id, senderType);
  }
}

@ApiTags('messages')
@Controller('provider/messages')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('PROVIDER')
@ApiBearerAuth()
export class ProviderMessagesController {
  constructor(private messages: MessagesService) {}

  @Get()
  @ApiOperation({ summary: 'Get all conversations for authenticated provider' })
  @ApiQuery({ name: 'status', required: false, type: String })
  getProviderConversations(@CurrentUser() user: AuthenticatedUser, @Query('status') status?: string) {
    return this.messages.getProviderConversations(user.id, status);
  }
}
