import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../services/redis/redis.service';

export interface NotificationPreferences {
  bookingUpdates: boolean;
  bookingMessages: boolean;
  paymentAlerts: boolean;
  accountAlerts: boolean;
}

const NOTIFICATION_PREFERENCE_SELECT = {
  notifyBookingUpdates: true,
  notifyBookingMessages: true,
  notifyPaymentAlerts: true,
  notifyAccountAlerts: true,
} as const;

function toNotificationPreferences(record: {
  notifyBookingUpdates: boolean;
  notifyBookingMessages: boolean;
  notifyPaymentAlerts: boolean;
  notifyAccountAlerts: boolean;
}): NotificationPreferences {
  return {
    bookingUpdates: record.notifyBookingUpdates,
    bookingMessages: record.notifyBookingMessages,
    paymentAlerts: record.notifyPaymentAlerts,
    accountAlerts: record.notifyAccountAlerts,
  };
}

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async findById(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('User not found');
    const { passwordHash, twoFactorSecret, ...safe } = user;
    void passwordHash; void twoFactorSecret;
    return safe;
  }

  async updateProfile(id: string, data: { firstName?: string; lastName?: string; avatarUrl?: string }) {
    return this.prisma.user.update({ where: { id }, data });
  }

  async savePushToken(userId: string, token: string, platform: 'ios' | 'android' | 'web') {
    await this.prisma.pushToken.upsert({
      where: { token },
      update: { userId, isActive: true, platform },
      create: { userId, token, platform },
    });

    return { registered: true, platform };
  }

  async removePushToken(token: string) {
    await this.prisma.pushToken.updateMany({ where: { token }, data: { isActive: false } });
  }

  /** Notification preferences live on both User and Provider — same shared screen in the app for either account type. */
  async getNotificationPreferences(accountId: string, accountType: 'user' | 'provider'): Promise<NotificationPreferences> {
    const record = accountType === 'provider'
      ? await this.prisma.provider.findUnique({ where: { id: accountId }, select: NOTIFICATION_PREFERENCE_SELECT })
      : await this.prisma.user.findUnique({ where: { id: accountId }, select: NOTIFICATION_PREFERENCE_SELECT });
    if (!record) throw new NotFoundException('Account not found');
    return toNotificationPreferences(record);
  }

  async updateNotificationPreferences(
    accountId: string,
    accountType: 'user' | 'provider',
    changes: Partial<NotificationPreferences>,
  ): Promise<NotificationPreferences> {
    const data = {
      ...(changes.bookingUpdates !== undefined && { notifyBookingUpdates: changes.bookingUpdates }),
      ...(changes.bookingMessages !== undefined && { notifyBookingMessages: changes.bookingMessages }),
      ...(changes.paymentAlerts !== undefined && { notifyPaymentAlerts: changes.paymentAlerts }),
      ...(changes.accountAlerts !== undefined && { notifyAccountAlerts: changes.accountAlerts }),
    };
    const record = accountType === 'provider'
      ? await this.prisma.provider.update({ where: { id: accountId }, data, select: NOTIFICATION_PREFERENCE_SELECT })
      : await this.prisma.user.update({ where: { id: accountId }, data, select: NOTIFICATION_PREFERENCE_SELECT });
    return toNotificationPreferences(record);
  }

  /**
   * Permanent account deletion — App Store Guideline 5.1.1(v) / Google Play.
   * We anonymise rather than hard-delete so bookings, payments and dispute
   * records stay intact (POPIA-compliant retention); the account can no longer
   * be signed into and carries no personal data.
   */
  async deleteAccount(accountId: string, accountType: 'user' | 'provider' | 'admin') {
    if (accountType === 'admin') {
      throw new ForbiddenException('Admin accounts cannot be deleted from the app.');
    }

    const ownerFilter =
      accountType === 'provider' ? { providerId: accountId } : { userId: accountId };

    const activeBookings = await this.prisma.booking.count({
      where: { status: { in: ['PENDING', 'ACCEPTED', 'IN_PROGRESS', 'DISPUTED'] }, ...ownerFilter },
    });
    if (activeBookings > 0) {
      throw new ConflictException(
        'Complete or cancel your active bookings before deleting your account.',
      );
    }

    if (accountType === 'provider') {
      const wallet = await this.prisma.wallet.findUnique({ where: { providerId: accountId } });
      if (wallet && (wallet.balance.greaterThan(0) || wallet.pendingBalance.greaterThan(0))) {
        throw new ConflictException(
          'Withdraw your remaining wallet balance before deleting your account.',
        );
      }
    }

    const scrubbedEmail = `deleted_${accountId}@deleted.errandss.co.za`;
    const scrubbedPhone = `deleted_${accountId}`;

    if (accountType === 'provider') {
      await this.prisma.$transaction([
        this.prisma.oAuthAccount.deleteMany({ where: { providerId: accountId } }),
        this.prisma.pushToken.updateMany({ where: { userId: accountId }, data: { isActive: false } }),
        this.prisma.service.updateMany({ where: { providerId: accountId }, data: { isActive: false } }),
        this.prisma.provider.update({
          where: { id: accountId },
          data: {
            email: scrubbedEmail,
            phone: scrubbedPhone,
            firstName: 'Deleted',
            lastName: 'User',
            avatarUrl: null,
            passwordHash: null,
            bio: null,
            isActive: false,
            isAvailable: false,
            diditSessionId: null,
            kycDocuments: [],
            deletedAt: new Date(),
          },
        }),
      ]);
    } else {
      await this.prisma.$transaction([
        this.prisma.oAuthAccount.deleteMany({ where: { userId: accountId } }),
        this.prisma.pushToken.updateMany({ where: { userId: accountId }, data: { isActive: false } }),
        this.prisma.user.update({
          where: { id: accountId },
          data: {
            email: scrubbedEmail,
            phone: scrubbedPhone,
            firstName: 'Deleted',
            lastName: 'User',
            avatarUrl: null,
            passwordHash: null,
            isActive: false,
            isTwoFactorEnabled: false,
            twoFactorSecret: null,
            deletedAt: new Date(),
          },
        }),
      ]);
    }

    // Invalidate the refresh token so the (still-valid, short-lived) access
    // token is the only thing left, and it expires on its own.
    await this.redis.del(`refresh_token:${accountType}:${accountId}`);

    return { deleted: true };
  }
}
