import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
@Injectable()
export class DisputesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}
  async create(raisedById: string, data: { bookingId: string; type: string; description: string; evidenceUrls?: string[] }) {
    const booking = await this.prisma.booking.findUniqueOrThrow({ where: { id: data.bookingId } });
    const raisedByUser = booking.userId === raisedById;
    await this.prisma.booking.update({ where: { id: data.bookingId }, data: { status: 'DISPUTED' } });
    const dispute = await this.prisma.dispute.create({
      data: raisedByUser
        ? { ...data, raisedByUserId: raisedById, againstProviderId: booking.providerId, type: data.type as never }
        : { ...data, raisedByProviderId: raisedById, againstUserId: booking.userId, type: data.type as never },
    });

    const againstId = raisedByUser ? booking.providerId : booking.userId;
    void this.notifications
      .send(
        againstId,
        'DISPUTE_OPENED',
        'A dispute was opened',
        'A dispute has been raised on one of your bookings. Open it to respond.',
        { bookingId: data.bookingId, type: 'dispute' },
        raisedByUser ? 'provider' : 'user',
      )
      .catch(() => undefined);

    return dispute;
  }
  async findAll(adminOnly = false) {
    return this.prisma.dispute.findMany({
      where: adminOnly ? {} : { status: { not: 'CLOSED' } },
      orderBy: { createdAt: 'desc' },
      include: {
        raisedByUser: { select: { id: true, firstName: true, lastName: true, email: true } },
        raisedByProvider: { select: { id: true, firstName: true, lastName: true, email: true } },
        againstUser: { select: { id: true, firstName: true, lastName: true, email: true } },
        againstProvider: { select: { id: true, firstName: true, lastName: true, email: true } },
        booking: { select: { id: true, status: true, quotedPrice: true, finalPrice: true } },
      },
    });
  }
  async findOne(id: string) {
    return this.prisma.dispute.findUniqueOrThrow({
      where: { id },
      include: {
        raisedByUser: { select: { id: true, firstName: true, lastName: true, email: true } },
        raisedByProvider: { select: { id: true, firstName: true, lastName: true, email: true } },
        againstUser: { select: { id: true, firstName: true, lastName: true, email: true } },
        againstProvider: { select: { id: true, firstName: true, lastName: true, email: true } },
        resolvedBy: { select: { id: true, firstName: true, lastName: true } },
        booking: { select: { id: true, status: true, quotedPrice: true, finalPrice: true, createdAt: true } },
      },
    });
  }

  async resolve(id: string, resolvedById: string, resolution: string) {
    const dispute = await this.prisma.dispute.update({ where: { id }, data: { status: 'RESOLVED', resolution, resolvedById, resolvedAt: new Date() } });
    await this.audit.log({ actorId: resolvedById, actorType: 'user', action: 'DISPUTE_RESOLVED', entityType: 'Dispute', entityId: id });

    const data = { bookingId: dispute.bookingId, type: 'dispute' };
    const body = `Outcome: ${resolution}`;
    const userId = dispute.raisedByUserId ?? dispute.againstUserId;
    const providerId = dispute.raisedByProviderId ?? dispute.againstProviderId;
    if (userId) {
      void this.notifications
        .send(userId, 'DISPUTE_RESOLVED', 'Dispute resolved', body, data, 'user')
        .catch(() => undefined);
    }
    if (providerId) {
      void this.notifications
        .send(providerId, 'DISPUTE_RESOLVED', 'Dispute resolved', body, data, 'provider')
        .catch(() => undefined);
    }

    return dispute;
  }
}
