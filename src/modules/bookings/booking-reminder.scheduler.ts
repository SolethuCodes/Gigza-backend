import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../services/redis/redis.service';
import { NotificationsService } from '../notifications/notifications.service';

// Africa/Johannesburg — fixed UTC+2, no DST.
const SA_UTC_OFFSET_MS = 2 * 60 * 60 * 1000;
const LEAD_MINUTES = 60; // remind ~1h before the slot
const WINDOW_MINUTES = 10; // half-width of the match window (>= cron cadence)
const DEDUP_TTL_SECONDS = 6 * 60 * 60;

/**
 * Sends "your booking is coming up" reminders. `preferredDate` /
 * `preferredTimeSlot` are free-text local-time strings ("2026-08-30",
 * "09:00-10:00"), so this parses them into an absolute instant and fires once
 * per booking (Redis-deduped).
 */
@Injectable()
export class BookingReminderScheduler {
  private readonly logger = new Logger(BookingReminderScheduler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * "Pay now" bookings sit as AWAITING_PAYMENT until payment settles. If the
   * customer bails at the payment step the row lingers — sweep anything older
   * than 2h whose payment never completed. The window is generous so a delayed
   * gateway webhook can never lose a race with this.
   */
  @Cron(CronExpression.EVERY_30_MINUTES)
  async sweepAbandonedBookings(): Promise<void> {
    const cutoff = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const stale = await this.prisma.booking.findMany({
      where: {
        status: 'AWAITING_PAYMENT',
        createdAt: { lt: cutoff },
        payment: { is: { status: 'PENDING' } },
      },
      select: { id: true },
    });
    if (stale.length === 0) return;

    const ids = stale.map((b) => b.id);
    await this.prisma.$transaction([
      this.prisma.payment.deleteMany({ where: { bookingId: { in: ids } } }),
      this.prisma.booking.deleteMany({ where: { id: { in: ids } } }),
    ]);
    this.logger.log(`Swept ${ids.length} abandoned unpaid booking(s)`);
  }

  @Cron(CronExpression.EVERY_10_MINUTES)
  async sendUpcomingBookingReminders(): Promise<void> {
    const now = Date.now();
    const bookings = await this.prisma.booking.findMany({
      where: {
        status: 'ACCEPTED',
        preferredDate: { not: null },
        preferredTimeSlot: { not: null },
      },
      select: {
        id: true,
        userId: true,
        providerId: true,
        preferredDate: true,
        preferredTimeSlot: true,
      },
    });

    for (const b of bookings) {
      const startMs = this.parseStart(b.preferredDate as string, b.preferredTimeSlot as string);
      if (startMs === null) continue;

      const minutesUntil = (startMs - now) / 60_000;
      if (
        minutesUntil < LEAD_MINUTES - WINDOW_MINUTES ||
        minutesUntil > LEAD_MINUTES + WINDOW_MINUTES
      ) {
        continue;
      }

      const dedupKey = `booking_reminder:${b.id}`;
      if (await this.redis.exists(dedupKey)) continue;
      await this.redis.set(dedupKey, '1', DEDUP_TTL_SECONDS);

      const startLabel = (b.preferredTimeSlot as string).split('-')[0].trim();
      const data = { bookingId: b.id, type: 'booking_update' };
      void this.notifications
        .send(b.userId, 'SYSTEM_ALERT', 'Booking reminder', `Your booking starts at ${startLabel}.`, data, 'user', 'booking')
        .catch(() => undefined);
      void this.notifications
        .send(b.providerId, 'SYSTEM_ALERT', 'Job reminder', `You have a job starting at ${startLabel}.`, data, 'provider', 'booking')
        .catch(() => undefined);

      this.logger.log(`Reminder sent for booking ${b.id} (~${Math.round(minutesUntil)}min out)`);
    }
  }

  /** "YYYY-MM-DD" + "HH:mm[-HH:mm]" interpreted as SA local time -> epoch ms. */
  private parseStart(date: string, slot: string): number | null {
    const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
    const t = /^(\d{1,2}):(\d{2})/.exec(slot.trim());
    if (!d || !t) return null;
    const ms = Date.UTC(+d[1], +d[2] - 1, +d[3], +t[1], +t[2]) - SA_UTC_OFFSET_MS;
    return Number.isNaN(ms) ? null : ms;
  }
}
