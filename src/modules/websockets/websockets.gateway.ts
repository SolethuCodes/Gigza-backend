import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger, UseGuards } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { socketCorsOptions } from '../../config/cors';

interface AuthSocket extends Socket {
  userId?: string;
  userRole?: string;
}

@WebSocketGateway({
  cors: socketCorsOptions(),
  namespace: '/ws',
})
export class WebsocketsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(WebsocketsGateway.name);

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async handleConnection(client: AuthSocket) {
    const token = client.handshake.auth['token'] as string | undefined
      ?? (client.handshake.headers['authorization'] as string | undefined)?.split(' ')[1];

    if (!token) {
      client.disconnect();
      return;
    }

    try {
      const payload = await this.jwt.verifyAsync<{ sub: string; role: string }>(token, {
        secret: this.config.get<string>('auth.jwtSecret'),
      });
      client.userId = payload.sub;
      client.userRole = payload.role;
      await client.join(`user:${payload.sub}`);
      this.logger.log(`Client connected: ${payload.sub} (${payload.role})`);
    } catch {
      client.disconnect();
    }
  }

  handleDisconnect(client: AuthSocket) {
    if (client.userId) {
      this.logger.log(`Client disconnected: ${client.userId}`);
    }
  }

  // Provider joins a booking room to stream location
  @SubscribeMessage('join:booking')
  handleJoinBooking(
    @ConnectedSocket() client: AuthSocket,
    @MessageBody() data: { bookingId: string },
  ) {
    void client.join(`booking:${data.bookingId}`);
    return { event: 'joined', bookingId: data.bookingId };
  }

  @SubscribeMessage('leave:booking')
  handleLeaveBooking(
    @ConnectedSocket() client: AuthSocket,
    @MessageBody() data: { bookingId: string },
  ) {
    void client.leave(`booking:${data.bookingId}`);
  }

  // Provider sends their live location during a booking
  @SubscribeMessage('provider:location')
  handleProviderLocation(
    @ConnectedSocket() client: AuthSocket,
    @MessageBody() data: { bookingId: string; latitude: number; longitude: number },
  ) {
    this.server.to(`booking:${data.bookingId}`).emit('provider:location', {
      providerId: client.userId,
      ...data,
      timestamp: new Date().toISOString(),
    });
  }

  // Emit booking status change to all parties
  emitBookingUpdate(bookingId: string, userId: string, providerId: string, status: string) {
    const payload = { bookingId, status, timestamp: new Date().toISOString() };
    this.server.to(`booking:${bookingId}`).emit('booking:status', payload);
    this.server.to(`user:${userId}`).emit('booking:status', payload);
    this.server.to(`user:${providerId}`).emit('booking:status', payload);
  }

  // Emit a notification to a specific user
  emitNotification(userId: string, notification: { title: string; body: string; type: string; data?: unknown }) {
    this.server.to(`user:${userId}`).emit('notification', {
      ...notification,
      timestamp: new Date().toISOString(),
    });
  }

  // Emit new booking request to provider
  emitNewRequest(providerId: string, request: unknown) {
    this.server.to(`user:${providerId}`).emit('request:new', request);
  }
}
