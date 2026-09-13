import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PushService } from '../../services/push/push.service';
import { CreateMessageDto } from './dto';
import { MessageType, SenderType } from '@prisma/client';

@Injectable()
export class MessagesService {
  constructor(
    private prisma: PrismaService,
    private push: PushService,
  ) {}

  /**
   * Resolve the (customer, provider) conversation a booking belongs to.
   * There is one thread per pair, reused across every booking between them.
   */
  private async resolveConversation(
    bookingId: string,
    actorId: string,
    actorType: SenderType,
    createIfMissing: boolean,
  ) {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: { user: true, provider: true },
    });
    if (!booking) throw new NotFoundException('Booking not found');

    if (actorType === SenderType.USER && booking.userId !== actorId) {
      throw new ForbiddenException('You can only message your own bookings');
    }
    if (actorType === SenderType.PROVIDER && booking.providerId !== actorId) {
      throw new ForbiddenException('You can only message your assigned bookings');
    }

    let conversation = await this.prisma.conversation.findUnique({
      where: { userId_providerId: { userId: booking.userId, providerId: booking.providerId } },
    });
    if (!conversation && createIfMissing) {
      conversation = await this.prisma.conversation.create({
        data: {
          userId: booking.userId,
          providerId: booking.providerId,
          lastBookingId: booking.id,
        },
      });
    }

    return { booking, conversation };
  }

  async createMessage(bookingId: string, senderId: string, senderType: SenderType, dto: CreateMessageDto) {
    const { booking, conversation } = await this.resolveConversation(bookingId, senderId, senderType, true);

    const message = await this.prisma.message.create({
      data: {
        conversationId: conversation!.id,
        bookingId: booking.id,
        senderId,
        senderType,
        text: dto.text,
        type: (dto.type as MessageType) || MessageType.TEXT,
        metadata: dto.metadata ?? undefined,
      },
    });

    await this.prisma.conversation.update({
      where: { id: conversation!.id },
      data: {
        lastMessageId: message.id,
        lastMessageText: message.text,
        lastMessageAt: message.createdAt,
        lastBookingId: booking.id,
        unreadCountCustomer: senderType === SenderType.PROVIDER ? { increment: 1 } : 0,
        unreadCountProvider: senderType === SenderType.USER ? { increment: 1 } : 0,
      },
    });

    // Push the other party (skip automated SYSTEM messages — those are already
    // covered by booking-status notifications). Fire-and-forget.
    if (message.type !== MessageType.SYSTEM) {
      const recipientId =
        senderType === SenderType.USER ? booking.providerId : booking.userId;
      const sender =
        senderType === SenderType.USER ? booking.user : booking.provider;
      const senderName =
        [sender?.firstName, sender?.lastName].filter(Boolean).join(' ') || 'New message';
      const preview =
        message.type === MessageType.PHOTO
          ? '📷 Photo'
          : message.text.length > 140
            ? `${message.text.slice(0, 137)}…`
            : message.text;

      const recipientType = senderType === SenderType.USER ? 'provider' : 'user';
      void this.push
        .sendToUser(
          recipientId,
          {
            title: senderName,
            body: preview,
            data: { bookingId, type: 'booking_message' },
          },
          { category: 'message', recipientType },
        )
        .catch(() => undefined);
    }

    return message;
  }

  async getBookingMessages(bookingId: string, userId: string, userType: SenderType) {
    const { conversation } = await this.resolveConversation(bookingId, userId, userType, false);
    if (!conversation) return [];

    return this.prisma.message.findMany({
      where: { conversationId: conversation.id },
      orderBy: { createdAt: 'asc' },
    });
  }

  async markMessagesAsRead(bookingId: string, userId: string, userType: SenderType) {
    const { conversation } = await this.resolveConversation(bookingId, userId, userType, false);
    if (!conversation) return { count: 0 };

    const otherPartyType = userType === SenderType.USER ? SenderType.PROVIDER : SenderType.USER;

    const updatedMessages = await this.prisma.message.updateMany({
      where: { conversationId: conversation.id, senderType: otherPartyType, readAt: null },
      data: { readAt: new Date() },
    });

    await this.prisma.conversation.update({
      where: { id: conversation.id },
      data: userType === SenderType.USER ? { unreadCountCustomer: 0 } : { unreadCountProvider: 0 },
    });

    return updatedMessages;
  }

  async getUserConversations(userId: string, status?: string) {
    const conversations = await this.prisma.conversation.findMany({
      where: { userId },
      orderBy: [{ lastMessageAt: { sort: 'desc', nulls: 'last' } }, { updatedAt: 'desc' }],
      include: {
        provider: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
        lastBooking: { select: { id: true, status: true } },
      },
    });

    return conversations
      .filter((c) => !status || c.lastBooking?.status === status)
      .map((c) => ({
        conversationId: c.id,
        bookingId: c.lastBookingId,
        provider: c.provider,
        lastMessage: c.lastMessageText,
        lastMessageAt: c.lastMessageAt,
        unreadCount: c.unreadCountCustomer || 0,
        status: c.lastBooking?.status ?? 'PENDING',
      }));
  }

  async getProviderConversations(providerId: string, status?: string) {
    const conversations = await this.prisma.conversation.findMany({
      where: { providerId },
      orderBy: [{ lastMessageAt: { sort: 'desc', nulls: 'last' } }, { updatedAt: 'desc' }],
      include: {
        user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
        lastBooking: { select: { id: true, status: true } },
      },
    });

    return conversations
      .filter((c) => !status || c.lastBooking?.status === status)
      .map((c) => ({
        conversationId: c.id,
        bookingId: c.lastBookingId,
        customer: c.user,
        lastMessage: c.lastMessageText,
        lastMessageAt: c.lastMessageAt,
        unreadCount: c.unreadCountProvider || 0,
        status: c.lastBooking?.status ?? 'PENDING',
      }));
  }
}
