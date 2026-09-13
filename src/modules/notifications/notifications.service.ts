import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PushService, type PushCategory } from '../../services/push/push.service';

/** Map a notification `type` to the preference toggle that gates its push. */
function pushCategoryForType(type: string): PushCategory {
  const t = type.toUpperCase();
  if (t.startsWith('BOOKING_')) return 'booking';
  if (t.startsWith('PAYMENT_') || t.startsWith('WITHDRAWAL_') || t === 'PAYOUT') return 'payment';
  return 'account'; // KYC_*, REVIEW_*, DISPUTE_*, SYSTEM_ALERT, category, support…
}

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService, private readonly push: PushService) {}

  async send(
    recipientId: string,
    type: string,
    title: string,
    body: string,
    data?: Record<string, unknown>,
    recipientType: 'user' | 'provider' | 'admin' = 'user',
    category?: PushCategory,
  ) {
    await this.prisma.notification.create({
      data: {
        ...(recipientType === 'provider' ? { providerId: recipientId } : { userId: recipientId }),
        type: type as never,
        title,
        body,
        data: data as never,
      },
    });
    await this.push.sendToUser(
      recipientId,
      { title, body, data: data ? Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)])) : undefined },
      { category: category ?? pushCategoryForType(type), recipientType },
    );
  }

  async getForUser(recipientId: string, recipientType: 'user' | 'provider' | 'admin' = 'user') {
    return this.prisma.notification.findMany({
      where: recipientType === 'provider' ? { providerId: recipientId } : { userId: recipientId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  async markRead(id: string, recipientId: string, recipientType: 'user' | 'provider' | 'admin' = 'user') {
    return this.prisma.notification.updateMany({
      where: recipientType === 'provider' ? { id, providerId: recipientId } : { id, userId: recipientId },
      data: { isRead: true, readAt: new Date() },
    });
  }

  async markAllRead(recipientId: string, recipientType: 'user' | 'provider' | 'admin' = 'user') {
    return this.prisma.notification.updateMany({
      where: recipientType === 'provider' ? { providerId: recipientId, isRead: false } : { userId: recipientId, isRead: false },
      data: { isRead: true, readAt: new Date() },
    });
  }
}
