import { WebSocketGateway, WebSocketServer, SubscribeMessage, OnGatewayConnection, OnGatewayDisconnect, ConnectedSocket, MessageBody } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Injectable } from '@nestjs/common';
import { MessagesService } from './messages.service';
import { socketCorsOptions } from '../../config/cors';
import { SenderType } from '@prisma/client';

interface AuthenticatedSocket extends Socket {
  userId?: string;
  userType?: SenderType;
  bookingId?: string;
}

@WebSocketGateway({
  namespace: 'messages',
  cors: socketCorsOptions(),
})
@Injectable()
export class MessagesGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  constructor(private messagesService: MessagesService) {}

  handleConnection(@ConnectedSocket() client: AuthenticatedSocket) {
    console.log(`[Messages Gateway] Client connected: ${client.id}`);
    // Client should join a room after authentication via event
  }

  handleDisconnect(@ConnectedSocket() client: AuthenticatedSocket) {
    console.log(`[Messages Gateway] Client disconnected: ${client.id}`);
  }

  @SubscribeMessage('join:booking')
  handleJoinBooking(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { bookingId: string; userId: string; userType: SenderType },
  ) {
    client.join(`booking:${data.bookingId}`);
    client.userId = data.userId;
    client.userType = data.userType;
    client.bookingId = data.bookingId;

    // Notify others in the room that someone joined
    this.server.to(`booking:${data.bookingId}`).emit('user:online', {
      userId: data.userId,
      userType: data.userType,
    });

    console.log(`[Messages Gateway] User ${data.userId} joined booking ${data.bookingId}`);
  }

  @SubscribeMessage('leave:booking')
  handleLeaveBooking(@ConnectedSocket() client: AuthenticatedSocket, @MessageBody() data: { bookingId: string }) {
    client.leave(`booking:${data.bookingId}`);

    this.server.to(`booking:${data.bookingId}`).emit('user:offline', {
      userId: client.userId,
      userType: client.userType,
    });

    console.log(`[Messages Gateway] User ${client.userId} left booking ${data.bookingId}`);
  }

  @SubscribeMessage('message:send')
  async handleSendMessage(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { bookingId: string; text: string; type?: string; metadata?: Record<string, any> },
  ) {
    if (!client.userId || !client.userType) {
      client.emit('error', { message: 'Not authenticated' });
      return;
    }

    try {
      const message = await this.messagesService.createMessage(
        data.bookingId,
        client.userId,
        client.userType,
        {
          text: data.text,
          type: data.type as any,
          metadata: data.metadata,
        },
      );

      // Broadcast to all clients in the booking room
      this.server.to(`booking:${data.bookingId}`).emit('message:new', message);
    } catch (error: any) {
      client.emit('error', { message: error?.message || 'Failed to send message' });
    }
  }

  @SubscribeMessage('message:read')
  async handleMarkAsRead(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { bookingId: string },
  ) {
    if (!client.userId || !client.userType) {
      client.emit('error', { message: 'Not authenticated' });
      return;
    }

    try {
      await this.messagesService.markMessagesAsRead(data.bookingId, client.userId, client.userType);

      // Broadcast read status to all clients in the room
      this.server.to(`booking:${data.bookingId}`).emit('message:read-status', {
        userId: client.userId,
        userType: client.userType,
        bookingId: data.bookingId,
      });
    } catch (error: any) {
      client.emit('error', { message: error?.message || 'Failed to mark as read' });
    }
  }

  @SubscribeMessage('typing:start')
  handleTypingStart(@ConnectedSocket() client: AuthenticatedSocket, @MessageBody() data: { bookingId: string }) {
    if (!client.userId || !client.userType) {
      return;
    }

    this.server.to(`booking:${data.bookingId}`).emit('typing:indicator', {
      userId: client.userId,
      userType: client.userType,
      isTyping: true,
    });
  }

  @SubscribeMessage('typing:stop')
  handleTypingStop(@ConnectedSocket() client: AuthenticatedSocket, @MessageBody() data: { bookingId: string }) {
    if (!client.userId || !client.userType) {
      return;
    }

    this.server.to(`booking:${data.bookingId}`).emit('typing:indicator', {
      userId: client.userId,
      userType: client.userType,
      isTyping: false,
    });
  }

  // Helper method to emit a message to a specific booking room
  emitMessageToBooking(bookingId: string, event: string, data: any) {
    this.server.to(`booking:${bookingId}`).emit(event, data);
  }
}
