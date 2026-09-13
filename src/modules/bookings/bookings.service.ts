import { Injectable, ForbiddenException, BadRequestException, Inject, forwardRef, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { WebsocketsGateway } from '../websockets/websockets.gateway';
import { NotificationsService } from '../notifications/notifications.service';
import { PaymentsService } from '../payments/payments.service';
import {
  completionQrSecret,
  createCompletionQrToken,
  hashCompletionToken,
  verifyCompletionQrToken,
} from './completion-qr.util';

@Injectable()
export class BookingsService {
  private readonly logger = new Logger(BookingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly ws: WebsocketsGateway,
    private readonly notifications: NotificationsService,
    @Inject(forwardRef(() => PaymentsService))
    private readonly payments: PaymentsService,
  ) {}

  async create(userId: string, data: { serviceId: string; providerId: string; quotedPrice: number; quantity?: number; estimatedDuration?: number; notes?: string; preferredDate?: string; preferredTimeSlot?: string; address?: string; latitude?: number; longitude?: number; paymentCategory?: 'online' | 'cash'; paymentTiming?: 'pay_now' | 'wait_approval' }) {
    // "pay now" + online bookings are held as AWAITING_PAYMENT — invisible to the
    // provider and to both booking lists — until payment settles (see
    // activatePaidBooking). Cash never runs through markPaymentCompleted (it
    // settles via the QR-scan completion flow instead), so it's excluded here —
    // otherwise it would sit as AWAITING_PAYMENT forever and get swept.
    const deferUntilPaid = data.paymentTiming === 'pay_now' && data.paymentCategory !== 'cash';

    // Clear out any earlier abandoned "pay now" attempt for this same service so
    // retries don't pile up unpaid rows.
    const abandoned = await this.prisma.booking.findMany({
      where: { userId, serviceId: data.serviceId, status: 'AWAITING_PAYMENT' },
      select: { id: true },
    });
    if (abandoned.length > 0) {
      const ids = abandoned.map((b) => b.id);
      await this.prisma.$transaction([
        this.prisma.payment.deleteMany({ where: { bookingId: { in: ids } } }),
        this.prisma.booking.deleteMany({ where: { id: { in: ids } } }),
      ]);
    }

    const activeBooking = await this.prisma.booking.findFirst({
      where: {
        userId,
        serviceId: data.serviceId,
        status: { in: ['PENDING', 'ACCEPTED', 'IN_PROGRESS', 'DISPUTED'] },
      },
    });

    if (activeBooking) {
      throw new BadRequestException('You already have an active booking for this service. Please complete or cancel it before creating another one.');
    }

    const provider = await this.prisma.provider.findUnique({
      where: { id: data.providerId },
      select: { kycStatus: true, isActive: true, isBanned: true },
    });
    if (!provider || !provider.isActive || provider.isBanned || provider.kycStatus !== 'APPROVED') {
      throw new BadRequestException('This provider is not available for bookings yet.');
    }

    const commissionRate = await this.resolveCommissionRate();

    const service = await this.prisma.service.findUnique({
      where: { id: data.serviceId },
      select: { name: true, basePrice: true, pricingType: true, unitLabel: true },
    });

    // For per-item services the server owns the price: item price × quantity.
    // The client-sent quotedPrice is ignored so it can't set an arbitrary total.
    const quantity =
      service?.pricingType === 'PER_ITEM'
        ? Math.max(1, Math.floor(data.quantity ?? 1))
        : 1;
    const quotedPrice =
      service?.pricingType === 'PER_ITEM'
        ? Math.round(Number(service.basePrice ?? 0) * quantity * 100) / 100
        : data.quotedPrice;
    if (service?.pricingType === 'PER_ITEM' && quotedPrice <= 0) {
      throw new BadRequestException('This service has no per-item price set.');
    }

    const booking = await this.prisma.booking.create({
      data: {
        serviceId: data.serviceId,
        providerId: data.providerId,
        userId,
        quotedPrice,
        quantity,
        commissionRate,
        status: deferUntilPaid ? 'AWAITING_PAYMENT' : 'PENDING',
        estimatedDuration: data.estimatedDuration,
        notes: data.notes,
        preferredDate: data.preferredDate,
        preferredTimeSlot: data.preferredTimeSlot,
        address: data.address,
        latitude: data.latitude !== undefined ? data.latitude : null,
        longitude: data.longitude !== undefined ? data.longitude : null,
      },
      include: { user: true, provider: { include: { currentLocation: true } } },
    });

    const commissionAmount = Math.round(quotedPrice * commissionRate * 100) / 100;
    const isCash = data.paymentCategory === 'cash';
    const payment = await this.prisma.payment.create({
      data: {
        bookingId: booking.id,
        userId,
        providerId: booking.providerId,
        amount: quotedPrice,
        commissionRate,
        commissionAmount,
        providerEarnings: Math.round((quotedPrice - commissionAmount) * 100) / 100,
        paymentMethod: isCash ? 'CASH' : 'CARD',
        paymentGateway: 'MANUAL',
        status: 'PENDING',
      },
    });

    // A "pay now" booking stays silent until payment settles — activatePaidBooking
    // fires this announcement then. Everything else announces immediately.
    if (!deferUntilPaid) {
      await this.announceNewBookingRequest(booking, service);
    }

    return {
      ...booking,
      paymentStatus: payment.status,
      pricingBreakdown: this.buildPricingSummary(Number(booking.quotedPrice), commissionRate),
      estimatedArrivalTime: this.computeEstimatedArrivalTime(booking),
      estimatedDuration: booking.estimatedDuration ?? null,
    };
  }

  /**
   * Open the customer↔provider chat thread and tell the provider a request has
   * landed (websocket + push). Used by create() for non-deferred bookings and by
   * activatePaidBooking() once a "pay now" booking's payment settles.
   */
  private async announceNewBookingRequest(
    booking: { id: string; userId: string; providerId: string; quantity: number; user: { firstName: string; lastName: string } },
    service: { name: string | null; pricingType: string; unitLabel: string | null } | null,
  ) {
    // One chat thread per customer↔provider pair, reused across every booking.
    await this.prisma.conversation
      .upsert({
        where: { userId_providerId: { userId: booking.userId, providerId: booking.providerId } },
        update: { lastBookingId: booking.id },
        create: { userId: booking.userId, providerId: booking.providerId, lastBookingId: booking.id },
      })
      .catch(() => undefined);

    this.ws.emitNewRequest(booking.providerId, booking);

    // Fire-and-forget — never block on the provider push.
    void this.notifications
      .send(
        booking.providerId,
        'BOOKING_REQUEST',
        'New booking request',
        `${booking.user.firstName} ${booking.user.lastName} requested ${service?.name ?? 'a service'}${
          service?.pricingType === 'PER_ITEM'
            ? ` (×${booking.quantity} ${service.unitLabel ?? 'items'})`
            : ''
        }.`,
        { bookingId: booking.id, type: 'booking_request' },
        'provider',
      )
      .catch(() => undefined);
  }

  /**
   * Promote a paid "pay now" booking from AWAITING_PAYMENT to PENDING and notify
   * the provider. Idempotent — called from PaymentsService.markPaymentCompleted
   * for every settlement route (webhook, sync verify, gateway return).
   */
  async activatePaidBooking(bookingId: string) {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: { user: true },
    });
    if (!booking || booking.status !== 'AWAITING_PAYMENT') return;

    await this.prisma.booking.update({
      where: { id: bookingId },
      data: { status: 'PENDING' },
    });

    const service = await this.prisma.service.findUnique({
      where: { id: booking.serviceId },
      select: { name: true, pricingType: true, unitLabel: true },
    });

    await this.announceNewBookingRequest(booking, service);
  }

  async update(id: string, actorId: string, data: { address?: string; latitude?: number; longitude?: number }) {
    const booking = await this.prisma.booking.findUniqueOrThrow({ where: { id } });

    if (booking.userId !== actorId && booking.providerId !== actorId) {
      throw new ForbiddenException('Only the customer or provider may update booking details');
    }

    return this.prisma.booking.update({
      where: { id },
      data: {
        address: data.address,
        latitude: data.latitude !== undefined ? data.latitude : undefined,
        longitude: data.longitude !== undefined ? data.longitude : undefined,
      },
    });
  }

  async updateStatus(id: string, actorId: string, status: string, reason?: string) {
    const booking = await this.prisma.booking.findUniqueOrThrow({ where: { id } });
    const normalizedStatus = this.normalizeStatus(status);

    if (normalizedStatus === 'COMPLETED') {
      throw new BadRequestException('Bookings can only be completed by scanning the customer completion QR');
    }

    const allowedTransitions: Record<string, string[]> = {
      PENDING: ['ACCEPTED', 'DECLINED', 'CANCELLED'],
      ACCEPTED: ['IN_PROGRESS', 'CANCELLED'],
      IN_PROGRESS: [],
      COMPLETED: ['PAID'],
      PAID: [],
      CANCELLED: [],
      DECLINED: [],
    };

    if (!Object.keys(allowedTransitions).includes(normalizedStatus)) {
      throw new BadRequestException(`Invalid booking status '${status}'`);
    }

    if (!allowedTransitions[booking.status].includes(normalizedStatus)) {
      throw new BadRequestException(`Cannot change booking status from '${booking.status}' to '${normalizedStatus}'`);
    }

    const providerOnlyStatuses = ['ACCEPTED', 'IN_PROGRESS', 'DECLINED'];
    const anyPartyStatuses = ['CANCELLED'];

    if (providerOnlyStatuses.includes(normalizedStatus) && booking.providerId !== actorId) {
      throw new ForbiddenException('Only the provider may update booking to this status');
    }

    if (normalizedStatus === 'ACCEPTED') {
      const provider = await this.prisma.provider.findUnique({
        where: { id: booking.providerId },
        select: { kycStatus: true },
      });
      if (provider?.kycStatus !== 'APPROVED') {
        throw new BadRequestException('Complete identity verification before accepting paid jobs.');
      }
    }

    if (normalizedStatus === 'CANCELLED' && booking.userId !== actorId && booking.providerId !== actorId) {
      throw new ForbiddenException('Only the customer or provider may cancel the booking');
    }

    const timestamps: Record<string, Date> = {};
    if (normalizedStatus === 'ACCEPTED') timestamps.acceptedAt = new Date();
    if (normalizedStatus === 'IN_PROGRESS') {
      const payment = await this.prisma.payment.findUnique({ where: { bookingId: id } });
      const isCash = payment?.paymentMethod === 'CASH';
      if (!isCash && payment?.status !== 'COMPLETED') {
        throw new BadRequestException('Payment must be completed before the job can start');
      }
      timestamps.startedAt = new Date();
    }
    if (['CANCELLED', 'DECLINED'].includes(normalizedStatus)) timestamps.cancelledAt = new Date();

    const updated = await this.prisma.booking.update({
      where: { id },
      data: {
        status: normalizedStatus as never,
        cancellationReason: ['CANCELLED', 'DECLINED'].includes(normalizedStatus) ? reason : undefined,
        cancelledBy: ['CANCELLED', 'DECLINED'].includes(normalizedStatus) ? actorId : undefined,
        ...timestamps,
      },
    });

    const notificationPayload = { bookingId: id, reason };
    const notificationTasks: Promise<unknown>[] = [];

    if (normalizedStatus === 'ACCEPTED') {
      const userMessage = 'Your booking has been accepted by the provider.';
      const providerMessage = 'You have accepted the booking request.';

      notificationTasks.push(
        this.notifications.send(
          booking.userId,
          'BOOKING_ACCEPTED',
          'Booking accepted',
          userMessage,
          { bookingId: id },
          'user',
        ).then(() => {
          this.ws.emitNotification(booking.userId, {
            title: 'Booking accepted',
            body: userMessage,
            type: 'BOOKING_ACCEPTED',
            data: { bookingId: id },
          });
        }).catch(() => undefined),
      );

      notificationTasks.push(
        this.notifications.send(
          booking.providerId,
          'BOOKING_ACCEPTED',
          'Booking accepted',
          providerMessage,
          { bookingId: id },
          'provider',
        ).then(() => {
          this.ws.emitNotification(booking.providerId, {
            title: 'Booking accepted',
            body: providerMessage,
            type: 'BOOKING_ACCEPTED',
            data: { bookingId: id },
          });
        }).catch(() => undefined),
      );
    }

    if (normalizedStatus === 'DECLINED') {
      const userMessage = reason
        ? `Your booking request has been declined by the provider. Reason: ${reason}`
        : 'Your booking request has been declined by the provider.';
      const providerMessage = reason
        ? `You declined the booking request. Reason: ${reason}`
        : 'You declined the booking request.';

      notificationTasks.push(
        this.notifications.send(
          booking.userId,
          'BOOKING_DECLINED',
          'Booking declined',
          userMessage,
          notificationPayload,
          'user',
        ).then(() => {
          this.ws.emitNotification(booking.userId, {
            title: 'Booking declined',
            body: userMessage,
            type: 'BOOKING_DECLINED',
            data: notificationPayload,
          });
        }).catch(() => undefined),
      );

      notificationTasks.push(
        this.notifications.send(
          booking.providerId,
          'BOOKING_DECLINED',
          'Booking declined',
          providerMessage,
          notificationPayload,
          'provider',
        ).then(() => {
          this.ws.emitNotification(booking.providerId, {
            title: 'Booking declined',
            body: providerMessage,
            type: 'BOOKING_DECLINED',
            data: notificationPayload,
          });
        }).catch(() => undefined),
      );
    }

    if (normalizedStatus === 'IN_PROGRESS') {
      const msg = 'The provider has started your booking.';
      notificationTasks.push(
        this.notifications
          .send(booking.userId, 'BOOKING_IN_PROGRESS', 'Booking in progress', msg,
            { bookingId: id, type: 'booking_update', status: 'in_progress' }, 'user', 'booking')
          .then(() => {
            this.ws.emitNotification(booking.userId, {
              title: 'Booking in progress', body: msg, type: 'BOOKING_IN_PROGRESS',
              data: { bookingId: id },
            });
          })
          .catch(() => undefined),
      );
    }

    if (normalizedStatus === 'CANCELLED') {
      const byProvider = actorId === booking.providerId;
      const data = { bookingId: id, type: 'booking_cancelled', reason };
      // Notify whoever didn't cancel (both, if an admin cancelled).
      if (actorId !== booking.userId) {
        const msg = byProvider
          ? `The provider cancelled this booking.${reason ? ` Reason: ${reason}` : ''}`
          : 'This booking was cancelled.';
        notificationTasks.push(
          this.notifications
            .send(booking.userId, 'SYSTEM_ALERT', 'Booking cancelled', msg, data, 'user', 'booking')
            .then(() => {
              this.ws.emitNotification(booking.userId, { title: 'Booking cancelled', body: msg, type: 'BOOKING_CANCELLED', data });
            })
            .catch(() => undefined),
        );
      }
      if (actorId !== booking.providerId) {
        const msg = `The customer cancelled this booking.${reason ? ` Reason: ${reason}` : ''}`;
        notificationTasks.push(
          this.notifications
            .send(booking.providerId, 'SYSTEM_ALERT', 'Booking cancelled', msg, data, 'provider', 'booking')
            .then(() => {
              this.ws.emitNotification(booking.providerId, { title: 'Booking cancelled', body: msg, type: 'BOOKING_CANCELLED', data });
            })
            .catch(() => undefined),
        );
      }
    }

    await Promise.all(notificationTasks);
    this.ws.emitBookingUpdate(id, booking.userId, booking.providerId, normalizedStatus);
    return updated;
  }

  async issueCompletionQr(bookingId: string, userId: string) {
    const booking = await this.prisma.booking.findUniqueOrThrow({
      where: { id: bookingId },
      include: { payment: true },
    });

    if (booking.userId !== userId) {
      throw new ForbiddenException('Only the customer can generate a completion QR');
    }
    if (booking.status !== 'IN_PROGRESS') {
      throw new BadRequestException('A completion QR can only be generated while the job is in progress');
    }
    const isCash = booking.payment?.paymentMethod === 'CASH';
    if (!isCash && booking.payment?.status !== 'COMPLETED') {
      throw new BadRequestException('Payment must be completed before generating a completion QR');
    }

    const secret = completionQrSecret(this.config.get<string>('auth.jwtSecret'));
    const issued = createCompletionQrToken(booking.id, secret);

    await this.prisma.bookingCompletionToken.upsert({
      where: { bookingId: booking.id },
      create: {
        bookingId: booking.id,
        token: hashCompletionToken(issued.token),
        expiresAt: issued.expiresAt,
        generatedByUserId: userId,
        scannedAt: null,
        scannedByProviderId: null,
      },
      update: {
        token: hashCompletionToken(issued.token),
        expiresAt: issued.expiresAt,
        generatedByUserId: userId,
        scannedAt: null,
        scannedByProviderId: null,
      },
    });

    return {
      token: issued.token,
      payload: issued.payload,
      expiresAt: issued.expiresAt.toISOString(),
      expiresInSeconds: issued.payload.exp - Math.floor(Date.now() / 1000),
    };
  }

  async completeByQr(providerId: string, token: string) {
    if (!token?.trim()) {
      throw new BadRequestException('token is required');
    }

    const secret = completionQrSecret(this.config.get<string>('auth.jwtSecret'));
    let payload: { bookingId: string; nonce: string; exp: number };
    try {
      payload = verifyCompletionQrToken(token.trim(), secret);
    } catch (err) {
      const code = err instanceof Error ? err.message : '';
      if (code === 'EXPIRED_TOKEN') {
        throw new BadRequestException('Completion QR has expired');
      }
      throw new BadRequestException('Invalid completion token');
    }

    const stored = await this.prisma.bookingCompletionToken.findUnique({
      where: { bookingId: payload.bookingId },
    });
    if (!stored) {
      throw new BadRequestException('Completion QR is not valid for this booking');
    }

    const incomingHash = hashCompletionToken(token.trim());
    const storedHash = Buffer.from(stored.token);
    const incomingHashBuf = Buffer.from(incomingHash);
    if (storedHash.length !== incomingHashBuf.length || !timingSafeEqual(storedHash, incomingHashBuf)) {
      throw new BadRequestException('Completion QR is no longer valid. Ask the customer to regenerate it.');
    }
    if (stored.scannedAt) {
      throw new BadRequestException('This completion QR has already been used');
    }
    if (stored.expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException('Completion QR has expired');
    }

    const booking = await this.prisma.booking.findUniqueOrThrow({
      where: { id: payload.bookingId },
      include: { payment: true },
    });

    if (booking.providerId !== providerId) {
      throw new ForbiddenException('Only the assigned provider may scan this completion QR');
    }
    if (booking.status !== 'IN_PROGRESS') {
      throw new BadRequestException('This booking is not in progress');
    }
    const isCash = booking.payment?.paymentMethod === 'CASH';
    if (!isCash && booking.payment?.status !== 'COMPLETED') {
      throw new BadRequestException('Payment must be completed before the job can be finished');
    }

    const now = new Date();
    const claimed = await this.prisma.bookingCompletionToken.updateMany({
      where: { id: stored.id, scannedAt: null },
      data: { scannedAt: now, scannedByProviderId: providerId },
    });
    if (claimed.count !== 1) {
      throw new BadRequestException('This completion QR has already been used');
    }

    await this.prisma.booking.update({
      where: { id: booking.id },
      data: { status: 'COMPLETED', completedAt: now },
    });

    let payout: { status: string; message: string } | null = null;
    if (isCash) {
      await this.prisma.payment.update({
        where: { bookingId: booking.id },
        data: {
          status: 'COMPLETED',
          paidAt: now,
          paymentMethod: 'CASH',
          paymentGateway: 'MANUAL',
        },
      });
      await this.prisma.booking.update({
        where: { id: booking.id },
        data: { status: 'PAID' },
      });
      payout = { status: 'CASH_SETTLED', message: 'Cash payment confirmed by QR scan' };
    } else {
      try {
        payout = await this.payments.releasePaymentToProvider(booking.id, booking.userId);
      } catch (err) {
        this.logger.warn(
          `QR completion marked booking ${booking.id} COMPLETED but payout release failed: ${err instanceof Error ? err.message : err}`,
        );
      }
    }

    await this.notifyBookingCompleted(booking.id, booking.userId, booking.providerId);
    this.ws.emitBookingUpdate(booking.id, booking.userId, booking.providerId, payout?.status === 'RELEASED' || payout?.status === 'CASH_SETTLED' ? 'PAID' : 'COMPLETED');

    const current = await this.prisma.booking.findUniqueOrThrow({
      where: { id: booking.id },
      include: { payment: true },
    });

    return {
      ...current,
      payout,
      paymentStatus: current.payment?.status ?? null,
    };
  }

  private async notifyBookingCompleted(bookingId: string, userId: string, providerId: string) {
    const userMessage = 'Your booking is complete. You can now rate the provider out of 5.';
    const providerMessage = 'This booking is complete. You can now rate the customer out of 5.';
    const data = { bookingId, type: 'booking_completed' };

    await Promise.all([
      this.notifications
        .send(userId, 'BOOKING_COMPLETED', 'Booking completed', userMessage, data, 'user', 'booking')
        .then(() => {
          this.ws.emitNotification(userId, {
            title: 'Booking completed',
            body: userMessage,
            type: 'BOOKING_COMPLETED',
            data,
          });
        })
        .catch(() => undefined),
      this.notifications
        .send(providerId, 'BOOKING_COMPLETED', 'Booking completed', providerMessage, data, 'provider', 'booking')
        .then(() => {
          this.ws.emitNotification(providerId, {
            title: 'Booking completed',
            body: providerMessage,
            type: 'BOOKING_COMPLETED',
            data,
          });
        })
        .catch(() => undefined),
    ]);
  }

  async findForUser(userId: string) {
    const bookings = await this.prisma.booking.findMany({
      where: { userId, status: { not: 'AWAITING_PAYMENT' } },
      include: { provider: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return this.attachServiceMeta(bookings);
  }

  async findForProvider(providerId: string) {
    const bookings = await this.prisma.booking.findMany({
      where: { providerId, status: { not: 'AWAITING_PAYMENT' } },
      include: { user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return this.attachServiceMeta(bookings);
  }

  /**
   * Booking has no `service` relation (services can be hard-deleted, so no FK),
   * so pull the pricing fields the UI needs in one query and merge them in.
   */
  private async attachServiceMeta<T extends { serviceId: string }>(bookings: T[]) {
    const ids = [...new Set(bookings.map((b) => b.serviceId))];
    if (ids.length === 0) return bookings.map((b) => ({ ...b, service: null }));
    const services = await this.prisma.service.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true, pricingType: true, unitLabel: true },
    });
    const byId = new Map(services.map((s) => [s.id, s]));
    return bookings.map((b) => ({ ...b, service: byId.get(b.serviceId) ?? null }));
  }

  async findOne(id: string) {
    const booking = await this.prisma.booking.findUniqueOrThrow({
      where: { id },
      include: { user: true, provider: { include: { currentLocation: true } }, payment: true, ratings: true },
    });
    const service = await this.prisma.service.findUnique({
      where: { id: booking.serviceId },
      select: { id: true, name: true, pricingType: true, unitLabel: true },
    });

    const estimatedArrivalTime = this.computeEstimatedArrivalTime(booking);
    let pricingBreakdown = null;
    try {
      pricingBreakdown = await this.payments.getBreakdown(id);
    } catch (err) {
      pricingBreakdown = null;
    }

    const paymentStatus = booking.payment?.status ?? null;

    return {
      ...booking,
      service,
      estimatedArrivalTime,
      estimatedDuration: booking.estimatedDuration ?? null,
      pricingBreakdown,
      paymentStatus,
    };
  }

  private normalizeStatus(status: string): string {
    return status.trim().toUpperCase().replace(/\s+/g, '_');
  }

  private computeEstimatedArrivalTime(booking: any): string | null {
    try {
      const reqLat = null;
      const reqLng = null;
      const provLat = booking.provider?.currentLocation?.latitude ? Number(booking.provider.currentLocation.latitude) : null;
      const provLng = booking.provider?.currentLocation?.longitude ? Number(booking.provider.currentLocation.longitude) : null;

      if (reqLat === null || reqLng === null || !provLat || !provLng) {
        return null;
      }

      if (reqLat && reqLng && provLat && provLng) {
        const toRad = (v: number) => (v * Math.PI) / 180;
        const R = 6371;
        const dLat = toRad(reqLat - provLat);
        const dLon = toRad(reqLng - provLng);
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(toRad(provLat)) * Math.cos(toRad(reqLat)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        const distanceKm = R * c;
        const speedKmh = 40;
        const etaMinutes = Math.max(1, Math.round((distanceKm / speedKmh) * 60));
        return new Date(Date.now() + etaMinutes * 60000).toISOString();
      }
    } catch {
      // ignore and return null
    }
    return null;
  }

  private buildPricingSummary(amount: number, commissionRate: number) {
    const commissionAmount = Math.round(amount * commissionRate * 100) / 100;
    return {
      basePrice: amount,
      serviceFee: 0,
      platformFee: commissionAmount,
      totalAmount: amount,
      currency: 'ZAR',
      commissionRate,
      commissionAmount,
      providerEarnings: Math.round((amount - commissionAmount) * 100) / 100,
    };
  }

  private async resolveCommissionRate() {
    const fallbackRateRaw = Number(this.config.get<number>('payment.commissionRate', 0.15));
    const fallbackRate = Number.isFinite(fallbackRateRaw) && fallbackRateRaw >= 0 ? fallbackRateRaw : 0.15;

    const settings = await this.prisma.adminSettings.findUnique({
      where: { id: 'singleton' },
      select: { defaultCommissionRate: true },
    });

    const adminRate = Number(settings?.defaultCommissionRate);
    return Number.isFinite(adminRate) && adminRate >= 0 ? adminRate : fallbackRate;
  }
}
