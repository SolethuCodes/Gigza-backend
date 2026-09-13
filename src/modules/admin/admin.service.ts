import { Injectable, BadRequestException, NotFoundException, UnauthorizedException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { WalletService } from '../wallet/wallet.service';
import { RedisService } from '../../services/redis/redis.service';
import { EmailService } from '../../services/email/email.service';
import { SmsService } from '../../services/sms/sms.service';
import { NotificationsService } from '../notifications/notifications.service';

const SAFE_USER_SELECT = {
  id: true, email: true, phone: true, firstName: true, lastName: true, role: true,
  isActive: true, isBanned: true, banReason: true, bannedAt: true, bannedBy: true,
  isEmailVerified: true, createdAt: true, updatedAt: true, lastLoginAt: true,
} as const;

const SAFE_PROVIDER_SELECT = {
  id: true, email: true, phone: true, firstName: true, lastName: true, kycStatus: true,
  kycRejectionReason: true, kycReviewNotes: true, kycReviewedAt: true, kycReviewedBy: true, isAvailable: true,
  isActive: true, isBanned: true, banReason: true, bannedAt: true, bannedBy: true,
  isEmailVerified: true, createdAt: true, updatedAt: true, lastLoginAt: true,
} as const;

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly wallet: WalletService,
    private readonly redis: RedisService,
    private readonly email: EmailService,
    private readonly sms: SmsService,
    private readonly notifications: NotificationsService,
    private readonly config: ConfigService,
  ) {}

  private readonly KYC_APPROVAL_OTP_MAX_ATTEMPTS = 5;

  private kycApprovalOtpKey(adminId: string) {
    return `kyc_approve_otp:admin:${adminId}`;
  }

  /**
   * Step 1 of approving a provider's KYC: re-check the admin's password, capture
   * the reviewer's notes, and email a one-time code to the admin. Nothing is
   * changed on the provider until {@link confirmProviderKycApproval}.
   */
  async requestProviderKycApproval(adminId: string, password: string, providerId: string, notes: string) {
    const admin = await this.prisma.admin.findUnique({ where: { id: adminId } });
    if (!admin?.passwordHash || !admin.isActive || admin.isBanned) {
      throw new UnauthorizedException('Invalid credentials');
    }
    const passwordOk = await bcrypt.compare(password, admin.passwordHash);
    if (!passwordOk) throw new BadRequestException('Password is incorrect');

    const provider = await this.prisma.provider.findUnique({
      where: { id: providerId },
      select: { id: true, firstName: true, lastName: true, kycStatus: true, deletedAt: true },
    });
    if (!provider || provider.deletedAt) throw new NotFoundException('Provider not found');
    if (provider.kycStatus !== 'PENDING' && provider.kycStatus !== 'UNDER_REVIEW') {
      throw new BadRequestException(`This provider's KYC is already ${provider.kycStatus.toLowerCase()}`);
    }

    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresInMinutes = this.config.get<number>('auth.otpExpiryMinutes', 10);
    await this.redis.set(
      this.kycApprovalOtpKey(adminId),
      JSON.stringify({ code, providerId, notes, attempts: 0 }),
      expiresInMinutes * 60,
    );

    await this.email.sendKycApprovalOtp(
      admin.email,
      admin.firstName,
      `${provider.firstName} ${provider.lastName}`.trim(),
      code,
    );

    if (this.config.get('OTP_DEBUG_LOG') === 'true') {
      this.logger.log(`[OTP] KYC approval code for ${admin.email} (provider ${providerId}): ${code}`);
    }

    await this.audit.log({
      actorId: adminId,
      actorType: 'admin',
      action: 'ADMIN_KYC_APPROVAL_REQUESTED',
      entityType: 'Provider',
      entityId: providerId,
      metadata: { notes },
    });

    return { message: 'A confirmation code has been emailed to you', expiresInMinutes };
  }

  /**
   * Step 2: verify the emailed code and mark the provider KYC-approved, recording
   * the notes captured in step 1 and who approved it.
   */
  async confirmProviderKycApproval(adminId: string, providerId: string, code: string) {
    const key = this.kycApprovalOtpKey(adminId);
    const stored = await this.redis.get(key);
    if (!stored) throw new BadRequestException('Your approval has expired. Start again.');

    const data = JSON.parse(stored) as { code: string; providerId: string; notes: string; attempts: number };

    if (data.attempts >= this.KYC_APPROVAL_OTP_MAX_ATTEMPTS) {
      await this.redis.del(key);
      throw new BadRequestException('Too many attempts. Start the approval again.');
    }
    if (data.providerId !== providerId) {
      throw new BadRequestException('This code was issued for a different provider.');
    }
    if (data.code !== code) {
      const expiresInMinutes = this.config.get<number>('auth.otpExpiryMinutes', 10);
      await this.redis.set(key, JSON.stringify({ ...data, attempts: data.attempts + 1 }), expiresInMinutes * 60);
      throw new BadRequestException('Invalid or expired code');
    }

    const provider = await this.prisma.provider.findUnique({
      where: { id: providerId },
      select: { id: true, kycStatus: true, deletedAt: true },
    });
    if (!provider || provider.deletedAt) throw new NotFoundException('Provider not found');
    if (provider.kycStatus !== 'PENDING' && provider.kycStatus !== 'UNDER_REVIEW') {
      await this.redis.del(key);
      throw new BadRequestException(`This provider's KYC is already ${provider.kycStatus.toLowerCase()}`);
    }

    const updated = await this.prisma.provider.update({
      where: { id: providerId },
      data: {
        kycStatus: 'APPROVED',
        kycReviewNotes: data.notes,
        kycRejectionReason: null,
        kycReviewedAt: new Date(),
        kycReviewedBy: adminId,
      },
      select: SAFE_PROVIDER_SELECT,
    });

    await this.redis.del(key);

    await this.audit.log({
      actorId: adminId,
      actorType: 'admin',
      action: 'ADMIN_KYC_APPROVED',
      entityType: 'Provider',
      entityId: providerId,
      metadata: { notes: data.notes },
    });

    this.notifications
      .send(
        providerId,
        'KYC_APPROVED',
        'You are verified',
        'Your identity verification has been approved. You can now receive bookings.',
        { type: 'kyc' },
        'provider',
      )
      .catch(() => null);

    this.email
      .sendKycApproval(updated.email, updated.firstName, true)
      .catch((error) => this.logger.error(`KYC approval email failed for ${updated.email}`, error));

    return updated;
  }

  async getUsers(page = 1, limit = 20, search?: string, status?: string, role?: string) {
    const where: Prisma.UserWhereInput = { deletedAt: null };
    if (search) {
      where.OR = [
        { email: { contains: search, mode: 'insensitive' } },
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (status === 'active') where.isBanned = false;
    if (status === 'suspended' || status === 'deactivated') where.isBanned = true;
    if (role && role !== 'all') where.role = role.toUpperCase() as never;

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true, email: true, phone: true, firstName: true, lastName: true, avatarUrl: true,
          role: true, isActive: true, isBanned: true, isEmailVerified: true, createdAt: true, lastLoginAt: true,
        },
      }),
      this.prisma.user.count({ where }),
    ]);
    return { users, total, page, limit };
  }

  async getUserDetail(id: string) {
    return this.prisma.user.findUniqueOrThrow({
      where: { id },
      select: {
        id: true, email: true, phone: true, firstName: true, lastName: true, avatarUrl: true,
        role: true, isEmailVerified: true, isPhoneVerified: true, isTwoFactorEnabled: true,
        isActive: true, isBanned: true, banReason: true, bannedAt: true, lastLoginAt: true,
        createdAt: true, updatedAt: true,
        bookingsAsUser: {
          take: 10,
          orderBy: { createdAt: 'desc' },
          select: { id: true, status: true, quotedPrice: true, finalPrice: true, createdAt: true },
        },
      },
    });
  }

  async getProviders(page = 1, limit = 20, search?: string, kycStatus?: string, status?: string) {
    const where: Prisma.ProviderWhereInput = { deletedAt: null };
    if (search) {
      where.OR = [
        { email: { contains: search, mode: 'insensitive' } },
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (kycStatus && kycStatus !== 'all') where.kycStatus = kycStatus.toUpperCase() as never;
    if (status === 'active') where.isBanned = false;
    if (status === 'suspended' || status === 'deactivated' || status === 'blocked') where.isBanned = true;

    const [providers, total] = await Promise.all([
      this.prisma.provider.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true, email: true, phone: true, firstName: true, lastName: true, kycStatus: true,
          isActive: true, isBanned: true, isEmailVerified: true, createdAt: true, lastLoginAt: true,
          avgRating: true, totalRatings: true, totalJobsCompleted: true,
          serviceCategories: { select: { category: { select: { name: true } } } },
        },
      }),
      this.prisma.provider.count({ where }),
    ]);
    return {
      providers: providers.map(({ serviceCategories, ...p }) => ({ ...p, categories: serviceCategories.map((sc) => sc.category.name) })),
      total,
      page,
      limit,
    };
  }

  async getProviderDetail(id: string) {
    return this.prisma.provider.findUniqueOrThrow({
      where: { id },
      select: {
        id: true, email: true, phone: true, firstName: true, lastName: true, avatarUrl: true, bio: true,
        isEmailVerified: true, isPhoneVerified: true, isActive: true, isBanned: true, banReason: true, bannedAt: true,
        kycStatus: true, kycDocuments: true, kycRejectionReason: true, kycReviewNotes: true, kycReviewedAt: true, kycReviewedBy: true,
        isAvailable: true, avgRating: true, totalRatings: true, totalJobsCompleted: true, serviceRadius: true,
        createdAt: true, updatedAt: true, lastLoginAt: true,
        wallet: { select: { balance: true, pendingBalance: true, totalEarned: true, totalWithdrawn: true, currency: true } },
        serviceCategories: { select: { basePrice: true, priceUnit: true, yearsExperience: true, category: { select: { id: true, name: true, slug: true } } } },
        bookingsAsProvider: {
          take: 10,
          orderBy: { createdAt: 'desc' },
          select: { id: true, status: true, quotedPrice: true, finalPrice: true, createdAt: true },
        },
      },
    });
  }

  async suspendUser(userId: string, adminId: string, reason: string) {
    const user = await this.prisma.user.update({ where: { id: userId }, data: { isBanned: true, banReason: reason, bannedAt: new Date(), bannedBy: adminId }, select: SAFE_USER_SELECT });
    await this.audit.log({ actorId: adminId, actorType: 'admin', action: 'USER_SUSPENDED', entityType: 'User', entityId: userId, metadata: { reason } });
    return user;
  }

  async unsuspendUser(userId: string, adminId: string) {
    const user = await this.prisma.user.update({ where: { id: userId }, data: { isBanned: false, banReason: null, bannedAt: null, bannedBy: null }, select: SAFE_USER_SELECT });
    await this.audit.log({ actorId: adminId, actorType: 'admin', action: 'USER_UNSUSPENDED', entityType: 'User', entityId: userId });
    return user;
  }

  async suspendProvider(providerId: string, adminId: string, reason: string) {
    const provider = await this.prisma.provider.update({ where: { id: providerId }, data: { isBanned: true, banReason: reason, bannedAt: new Date(), bannedBy: adminId }, select: SAFE_PROVIDER_SELECT });
    await this.audit.log({ actorId: adminId, actorType: 'admin', action: 'PROVIDER_SUSPENDED', entityType: 'Provider', entityId: providerId, metadata: { reason } });
    return provider;
  }

  async unsuspendProvider(providerId: string, adminId: string) {
    const provider = await this.prisma.provider.update({ where: { id: providerId }, data: { isBanned: false, banReason: null, bannedAt: null, bannedBy: null }, select: SAFE_PROVIDER_SELECT });
    await this.audit.log({ actorId: adminId, actorType: 'admin', action: 'PROVIDER_UNSUSPENDED', entityType: 'Provider', entityId: providerId });
    return provider;
  }

  async getBookings(page = 1, limit = 20, status?: string, search?: string) {
    const where: Prisma.BookingWhereInput = {};
    if (status && status !== 'all') where.status = status as never;
    if (search) {
      where.OR = [
        { address: { contains: search, mode: 'insensitive' } },
        { notes: { contains: search, mode: 'insensitive' } },
        { user: { OR: [
          { firstName: { contains: search, mode: 'insensitive' } },
          { lastName: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } },
        ] } },
        { provider: { OR: [
          { firstName: { contains: search, mode: 'insensitive' } },
          { lastName: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } },
        ] } },
      ];
    }

    const [bookings, total] = await Promise.all([
      this.prisma.booking.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          user: { select: { id: true, firstName: true, lastName: true, email: true } },
          provider: { select: { id: true, firstName: true, lastName: true, email: true } },
          payment: { select: { status: true, amount: true } },
        },
      }),
      this.prisma.booking.count({ where }),
    ]);

    const services = await this.lookupServices(bookings.map((b) => b.serviceId));
    return {
      bookings: bookings.map((booking) => ({
        ...booking,
        service: services.get(booking.serviceId) ?? null,
      })),
      total,
      page,
      limit,
    };
  }

  async getBookingDetail(id: string) {
    const booking = await this.prisma.booking.findUniqueOrThrow({
      where: { id },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } },
        provider: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } },
        payment: true,
        ratings: true,
        disputes: true,
      },
    });
    const services = await this.lookupServices([booking.serviceId]);
    return { ...booking, service: services.get(booking.serviceId) ?? null };
  }

  private async lookupServices(serviceIds: string[]) {
    const ids = [...new Set(serviceIds.filter(Boolean))];
    if (!ids.length) return new Map<string, { id: string; name: string; category?: { name: string } }>();
    const rows = await this.prisma.service.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true, category: { select: { name: true } } },
    });
    return new Map(rows.map((row) => [row.id, row]));
  }

  async getBookingAnalytics() {
    const [byStatus, total] = await Promise.all([
      this.prisma.booking.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.booking.count(),
    ]);
    const perDay = await this.prisma.$queryRaw<{ day: Date; count: bigint }[]>`
      SELECT date_trunc('day', "createdAt") AS day, COUNT(*) AS count
      FROM bookings
      WHERE "createdAt" > NOW() - INTERVAL '90 days'
      GROUP BY day
      ORDER BY day ASC
    `;
    return {
      total,
      byStatus: byStatus.map((s) => ({ status: s.status, count: s._count._all })),
      perDay: perDay.map((r) => ({ day: r.day, count: Number(r.count) })),
    };
  }

  async getTransactions(page = 1, limit = 20, status?: string, search?: string) {
    const where: Prisma.PaymentWhereInput = {};
    if (status && status !== 'all') where.status = status as never;
    if (search) {
      where.OR = [
        { invoiceNumber: { contains: search, mode: 'insensitive' } },
        { id: { contains: search, mode: 'insensitive' } },
        { gatewayTransactionId: { contains: search, mode: 'insensitive' } },
        { user: { OR: [
          { firstName: { contains: search, mode: 'insensitive' } },
          { lastName: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } },
        ] } },
        { provider: { OR: [
          { firstName: { contains: search, mode: 'insensitive' } },
          { lastName: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } },
        ] } },
      ];
    }
    const [transactions, total] = await Promise.all([
      this.prisma.payment.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          user: { select: { id: true, firstName: true, lastName: true, email: true } },
          provider: { select: { id: true, firstName: true, lastName: true, email: true } },
          booking: { select: { id: true, status: true, address: true } },
        },
      }),
      this.prisma.payment.count({ where }),
    ]);
    return { transactions, total, page, limit };
  }

  async getTransactionDetail(id: string) {
    return this.prisma.payment.findUniqueOrThrow({
      where: { id },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } },
        provider: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } },
        booking: { select: { id: true, status: true, address: true, quotedPrice: true, finalPrice: true, createdAt: true } },
      },
    });
  }

  async getWithdrawals(page = 1, limit = 20, status?: string) {
    const where = status && status !== 'all' ? { status: status as never } : {};
    const [withdrawals, total] = await Promise.all([
      this.prisma.withdrawalRequest.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: { provider: { select: { id: true, firstName: true, lastName: true, email: true } }, wallet: { select: { balance: true, pendingBalance: true } } },
      }),
      this.prisma.withdrawalRequest.count({ where }),
    ]);
    return { withdrawals, total, page, limit };
  }

  async getPendingWithdrawals() {
    return this.prisma.withdrawalRequest.findMany({ where: { status: 'PENDING' }, include: { provider: { select: { id: true, firstName: true, lastName: true, email: true } } }, orderBy: { createdAt: 'asc' } });
  }

  async approveWithdrawal(id: string, adminId: string) {
    const wr = await this.prisma.withdrawalRequest.findUniqueOrThrow({ where: { id } });
    
    // Find all pending payments for this provider and mark them COMPLETED
    const pendingPayments = await this.prisma.payment.findMany({
      where: { providerId: wr.providerId, status: 'PENDING' }
    });

    for (const payment of pendingPayments) {
      // Mark payment as COMPLETED
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: 'COMPLETED',
          gatewayTransactionId: `admin-approval-${id}`,
          paidAt: new Date(),
          gatewayResponse: { adminApprovalId: id, approvedAt: new Date().toISOString() }
        }
      });

      // Credit wallet for the completed payment
      await this.wallet.credit(payment.providerId, Number(payment.providerEarnings), payment.id, `Payout approved for booking ${payment.bookingId}`);

      // Mark booking as COMPLETED if not yet complete
      const booking = await this.prisma.booking.findUnique({ where: { id: payment.bookingId } });
      if (booking && booking.status !== 'COMPLETED' && booking.status !== 'PAID') {
        await this.prisma.booking.update({
          where: { id: payment.bookingId },
          data: { status: 'COMPLETED' }
        });
      }
    }

    // Update withdrawal request status to APPROVED
    const updatedWr = await this.prisma.withdrawalRequest.update({
      where: { id },
      data: { status: 'APPROVED', approvedById: adminId, processedAt: new Date() }
    });

    // Update wallet
    await this.prisma.wallet.update({
      where: { id: wr.walletId },
      data: { pendingBalance: { decrement: wr.amount }, totalWithdrawn: { increment: wr.amount } }
    });

    // Log the action with payment details
    await this.audit.log({
      actorId: adminId,
      actorType: 'admin',
      action: 'WITHDRAWAL_APPROVED',
      entityType: 'WithdrawalRequest',
      entityId: id,
      metadata: { paymentsCompleted: pendingPayments.length }
    });

    void this.notifications
      .send(wr.providerId, 'WITHDRAWAL_APPROVED', 'Withdrawal approved', `Your withdrawal of R${Number(wr.amount).toFixed(2)} has been approved.`, { type: 'payout' }, 'provider')
      .catch(() => undefined);

    return updatedWr;
  }

  async rejectWithdrawal(id: string, adminId: string, reason: string) {
    const wr = await this.prisma.withdrawalRequest.update({ where: { id }, data: { status: 'REJECTED', approvedById: adminId, rejectionReason: reason, rejectedAt: new Date() } });
    await this.prisma.wallet.update({ where: { id: wr.walletId }, data: { balance: { increment: wr.amount }, pendingBalance: { decrement: wr.amount } } });
    await this.audit.log({ actorId: adminId, actorType: 'admin', action: 'WITHDRAWAL_REJECTED', entityType: 'WithdrawalRequest', entityId: id, metadata: { reason } });
    void this.notifications
      .send(wr.providerId, 'WITHDRAWAL_REJECTED', 'Withdrawal rejected', `Your withdrawal of R${Number(wr.amount).toFixed(2)} was rejected: ${reason}`, { type: 'payout' }, 'provider')
      .catch(() => undefined);
    return wr;
  }

  async getFinancialSummary() {
    const [totalPayments, commissions, withdrawals, pendingWithdrawals] = await Promise.all([
      this.prisma.payment.aggregate({ where: { status: 'COMPLETED' }, _sum: { amount: true, commissionAmount: true } }),
      this.prisma.payment.count({ where: { status: 'COMPLETED' } }),
      this.prisma.withdrawalRequest.aggregate({ where: { status: 'COMPLETED' }, _sum: { amount: true } }),
      this.prisma.withdrawalRequest.count({ where: { status: 'PENDING' } }),
    ]);
    return { totalRevenue: totalPayments._sum.amount, totalCommissions: totalPayments._sum.commissionAmount, completedTransactions: commissions, totalWithdrawn: withdrawals._sum.amount, pendingWithdrawals };
  }

  async getDashboardStats() {
    const [totalUsers, totalProviders, totalBookings, completedBookings, revenue, openDisputes, pendingWithdrawals, pendingWithdrawalsAmount, pendingKyc] = await this.prisma.$transaction([
      this.prisma.user.count({ where: { role: 'USER', deletedAt: null } }),
      this.prisma.provider.count({ where: { deletedAt: null } }),
      this.prisma.booking.count(),
      this.prisma.booking.count({ where: { status: 'COMPLETED' } }),
      this.prisma.payment.aggregate({ where: { status: 'COMPLETED' }, _sum: { amount: true } }),
      this.prisma.dispute.count({ where: { status: { in: ['OPEN', 'UNDER_REVIEW'] } } }),
      this.prisma.withdrawalRequest.count({ where: { status: 'PENDING' } }),
      this.prisma.withdrawalRequest.aggregate({ where: { status: 'PENDING' }, _sum: { amount: true } }),
      this.prisma.provider.count({ where: { kycStatus: { in: ['PENDING', 'UNDER_REVIEW'] }, deletedAt: null } }),
    ]);
    return {
      totalUsers,
      totalProviders,
      totalBookings,
      completedBookings,
      totalRevenue: revenue._sum.amount ?? 0,
      openDisputes,
      pendingWithdrawals,
      pendingWithdrawalsAmount: pendingWithdrawalsAmount._sum.amount ?? 0,
      pendingKyc,
    };
  }

  async getSettings() {
    const row = await this.prisma.adminSettings.upsert({
      where: { id: 'singleton' },
      update: {},
      create: { id: 'singleton' },
    });
    return this.toPublicSettings(row);
  }

  async updateSettings(data: Record<string, unknown>, adminId: string) {
    const current = await this.prisma.adminSettings.upsert({
      where: { id: 'singleton' },
      update: {},
      create: { id: 'singleton' },
    });
    const patch = this.sanitizeSettingsPatch(data, current);
    if (!Object.keys(patch).length) {
      throw new BadRequestException('No valid settings fields to update');
    }

    const settings = await this.prisma.adminSettings.update({
      where: { id: 'singleton' },
      data: { ...patch, updatedBy: adminId },
    });

    await this.audit.log({
      actorId: adminId,
      actorType: 'admin',
      action: 'SETTINGS_UPDATED',
      entityType: 'AdminSettings',
      entityId: 'singleton',
      metadata: { fields: Object.keys(patch) },
    });
    return this.toPublicSettings(settings);
  }

  async sendTestEmail(to: string) {
    const settings = await this.prisma.adminSettings.findUnique({ where: { id: 'singleton' } });
    await this.email.sendAdminTest(to, {
      host: settings?.smtpHost,
      port: settings?.smtpPort,
      user: settings?.smtpUser,
      pass: settings?.smtpPassword,
      from: settings?.smtpFromAddress,
    });
    return { sent: true, to };
  }

  async sendTestSms(phone?: string) {
    if (!phone) throw new BadRequestException('A phone number is required to send a test SMS');
    const settings = await this.prisma.adminSettings.findUnique({ where: { id: 'singleton' } });
    await this.sms.sendBookingNotification(
      phone,
      `E-RRANDS test SMS from ${settings?.smsSenderId || 'E-RRANDS'}. Your SMS integration is working.`,
    );
    return { sent: true, phone };
  }

  async getProviderPerformanceReport(page = 1, limit = 20) {
    const [providers, total] = await Promise.all([
      this.prisma.provider.findMany({
        where: { deletedAt: null },
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { avgRating: 'desc' },
        select: { id: true, firstName: true, lastName: true, email: true, avgRating: true, totalRatings: true, totalJobsCompleted: true, kycStatus: true },
      }),
      this.prisma.provider.count({ where: { deletedAt: null } }),
    ]);
    return { providers, total, page, limit };
  }

  async getBookingsAnalytics(granularity: 'day' | 'month' = 'day') {
    const interval = granularity === 'month' ? '12 months' : '90 days';
    const trunc = granularity === 'month' ? 'month' : 'day';
    const rows = await this.prisma.$queryRawUnsafe<{ bucket: Date; status: string; count: bigint }[]>(
      `SELECT date_trunc('${trunc}', "createdAt") AS bucket, status, COUNT(*) AS count
       FROM bookings
       WHERE "createdAt" > NOW() - INTERVAL '${interval}'
       GROUP BY bucket, status
       ORDER BY bucket ASC`,
    );
    return rows.map((r) => ({ bucket: r.bucket, status: r.status, count: Number(r.count) }));
  }

  async getFinancialAnalytics(granularity: 'day' | 'month' = 'month') {
    const interval = granularity === 'month' ? '12 months' : '90 days';
    const trunc = granularity === 'month' ? 'month' : 'day';
    const rows = await this.prisma.$queryRawUnsafe<{ bucket: Date; revenue: string; commission: string }[]>(
      `SELECT date_trunc('${trunc}', "paidAt") AS bucket, SUM(amount) AS revenue, SUM("commissionAmount") AS commission
       FROM payments
       WHERE status = 'COMPLETED' AND "paidAt" > NOW() - INTERVAL '${interval}'
       GROUP BY bucket
       ORDER BY bucket ASC`,
    );
    return rows.map((r) => ({ bucket: r.bucket, revenue: Number(r.revenue), commission: Number(r.commission) }));
  }

  async getUserAnalytics() {
    const [byRole, signupsPerMonth, activeVsBanned] = await Promise.all([
      this.prisma.user.groupBy({ by: ['role'], _count: { _all: true } }),
      this.prisma.$queryRaw<{ bucket: Date; count: bigint }[]>`
        SELECT date_trunc('month', "createdAt") AS bucket, COUNT(*) AS count
        FROM users
        WHERE "createdAt" > NOW() - INTERVAL '12 months'
        GROUP BY bucket
        ORDER BY bucket ASC
      `,
      this.prisma.user.groupBy({ by: ['isBanned'], _count: { _all: true } }),
    ]);
    return {
      byRole: byRole.map((r) => ({ role: r.role, count: r._count._all })),
      signupsPerMonth: signupsPerMonth.map((r) => ({ bucket: r.bucket, count: Number(r.count) })),
      activeVsBanned: activeVsBanned.map((r) => ({ isBanned: r.isBanned, count: r._count._all })),
    };
  }

  async getSubjectActivity(params: {
    userId?: string;
    providerId?: string;
    bookingId?: string;
    page?: number;
    limit?: number;
  }) {
    const page = Math.max(1, params.page ?? 1);
    const limit = Math.min(200, Math.max(1, params.limit ?? 80));
    const events: Array<{
      id: string;
      at: Date;
      source: string;
      action: string;
      summary: string;
      metadata?: Record<string, unknown>;
    }> = [];

    const push = (
      id: string,
      at: Date | string | null | undefined,
      source: string,
      action: string,
      summary: string,
      metadata?: Record<string, unknown>,
    ) => {
      if (!at) return;
      events.push({ id, at: new Date(at), source, action, summary, metadata });
    };

    if (params.userId) {
      const [logs, bookings, payments, user] = await Promise.all([
        this.prisma.activityLog.findMany({
          where: {
            OR: [
              { userId: params.userId },
              { entityType: 'User', entityId: params.userId },
            ],
          },
          orderBy: { createdAt: 'desc' },
          take: 100,
        }),
        this.prisma.booking.findMany({
          where: { userId: params.userId },
          orderBy: { createdAt: 'desc' },
          take: 50,
          select: {
            id: true, status: true, createdAt: true, acceptedAt: true, startedAt: true,
            completedAt: true, cancelledAt: true, quotedPrice: true, finalPrice: true, address: true,
          },
        }),
        this.prisma.payment.findMany({
          where: { userId: params.userId },
          orderBy: { createdAt: 'desc' },
          take: 50,
          select: { id: true, status: true, amount: true, createdAt: true, paidAt: true, invoiceNumber: true },
        }),
        this.prisma.user.findUnique({
          where: { id: params.userId },
          select: { createdAt: true, lastLoginAt: true, bannedAt: true, banReason: true, isEmailVerified: true },
        }),
      ]);

      logs.forEach((log) => push(log.id, log.createdAt, 'audit', log.action, log.action.replace(/_/g, ' '), (log.metadata as Record<string, unknown>) ?? undefined));
      bookings.forEach((booking) => {
        push(`booking-${booking.id}-created`, booking.createdAt, 'booking', 'BOOKING_CREATED', `Booking ${booking.id.slice(0, 8)} placed`, { status: booking.status, amount: booking.quotedPrice });
        push(`booking-${booking.id}-accepted`, booking.acceptedAt, 'booking', 'BOOKING_ACCEPTED', `Booking ${booking.id.slice(0, 8)} accepted`);
        push(`booking-${booking.id}-started`, booking.startedAt, 'booking', 'BOOKING_STARTED', `Booking ${booking.id.slice(0, 8)} started`);
        push(`booking-${booking.id}-completed`, booking.completedAt, 'booking', 'BOOKING_COMPLETED', `Booking ${booking.id.slice(0, 8)} completed`);
        push(`booking-${booking.id}-cancelled`, booking.cancelledAt, 'booking', 'BOOKING_CANCELLED', `Booking ${booking.id.slice(0, 8)} cancelled`);
      });
      payments.forEach((payment) => {
        push(`payment-${payment.id}`, payment.paidAt ?? payment.createdAt, 'payment', `PAYMENT_${payment.status}`, `Payment ${payment.invoiceNumber} · ${payment.status}`, { amount: payment.amount });
      });
      if (user) {
        push(`user-created`, user.createdAt, 'account', 'ACCOUNT_CREATED', 'Customer account created');
        push(`user-login`, user.lastLoginAt, 'account', 'LAST_LOGIN', 'Last successful sign-in');
        push(`user-banned`, user.bannedAt, 'account', 'ACCOUNT_DEACTIVATED', user.banReason ?? 'Account deactivated');
      }
    }

    if (params.providerId) {
      const [logs, bookings, payments, provider] = await Promise.all([
        this.prisma.activityLog.findMany({
          where: {
            OR: [
              { providerId: params.providerId },
              { entityType: 'Provider', entityId: params.providerId },
            ],
          },
          orderBy: { createdAt: 'desc' },
          take: 100,
        }),
        this.prisma.booking.findMany({
          where: { providerId: params.providerId },
          orderBy: { createdAt: 'desc' },
          take: 50,
          select: {
            id: true, status: true, createdAt: true, acceptedAt: true, startedAt: true,
            completedAt: true, cancelledAt: true, quotedPrice: true,
          },
        }),
        this.prisma.payment.findMany({
          where: { providerId: params.providerId },
          orderBy: { createdAt: 'desc' },
          take: 50,
          select: { id: true, status: true, amount: true, createdAt: true, paidAt: true, invoiceNumber: true },
        }),
        this.prisma.provider.findUnique({
          where: { id: params.providerId },
          select: { createdAt: true, bannedAt: true, banReason: true, kycStatus: true, kycReviewedAt: true, kycRejectionReason: true },
        }),
      ]);

      logs.forEach((log) => push(log.id, log.createdAt, 'audit', log.action, log.action.replace(/_/g, ' '), (log.metadata as Record<string, unknown>) ?? undefined));
      bookings.forEach((booking) => {
        push(`booking-${booking.id}-created`, booking.createdAt, 'booking', 'JOB_ASSIGNED', `Job ${booking.id.slice(0, 8)} assigned`);
        push(`booking-${booking.id}-accepted`, booking.acceptedAt, 'booking', 'JOB_ACCEPTED', `Job ${booking.id.slice(0, 8)} accepted`);
        push(`booking-${booking.id}-started`, booking.startedAt, 'booking', 'JOB_STARTED', `Job ${booking.id.slice(0, 8)} started`);
        push(`booking-${booking.id}-completed`, booking.completedAt, 'booking', 'JOB_COMPLETED', `Job ${booking.id.slice(0, 8)} completed`);
        push(`booking-${booking.id}-cancelled`, booking.cancelledAt, 'booking', 'JOB_CANCELLED', `Job ${booking.id.slice(0, 8)} cancelled`);
      });
      payments.forEach((payment) => {
        push(`payment-${payment.id}`, payment.paidAt ?? payment.createdAt, 'payment', `PAYOUT_${payment.status}`, `Payout ${payment.invoiceNumber} · ${payment.status}`, { amount: payment.amount });
      });
      if (provider) {
        push(`provider-created`, provider.createdAt, 'account', 'PROVIDER_REGISTERED', 'Provider account created');
        push(`provider-kyc`, provider.kycReviewedAt, 'kyc', `KYC_${provider.kycStatus}`, `KYC ${provider.kycStatus.toLowerCase().replace('_', ' ')}`, { reason: provider.kycRejectionReason });
        push(`provider-banned`, provider.bannedAt, 'account', 'PROVIDER_DEACTIVATED', provider.banReason ?? 'Provider deactivated');
      }
    }

    if (params.bookingId) {
      const [logs, booking] = await Promise.all([
        this.prisma.activityLog.findMany({
          where: { entityType: 'Booking', entityId: params.bookingId },
          orderBy: { createdAt: 'desc' },
          take: 100,
        }),
        this.prisma.booking.findUnique({
          where: { id: params.bookingId },
          include: {
            payment: true,
            disputes: { orderBy: { createdAt: 'desc' } },
            ratings: { orderBy: { createdAt: 'desc' } },
          },
        }),
      ]);

      logs.forEach((log) => push(log.id, log.createdAt, 'audit', log.action, log.action.replace(/_/g, ' '), (log.metadata as Record<string, unknown>) ?? undefined));
      if (booking) {
        push(`booking-created`, booking.createdAt, 'booking', 'BOOKING_CREATED', 'Booking placed');
        push(`booking-accepted`, booking.acceptedAt, 'booking', 'BOOKING_ACCEPTED', 'Provider accepted');
        push(`booking-started`, booking.startedAt, 'booking', 'BOOKING_STARTED', 'Work started');
        push(`booking-completed`, booking.completedAt, 'booking', 'BOOKING_COMPLETED', 'Work completed');
        push(`booking-cancelled`, booking.cancelledAt, 'booking', 'BOOKING_CANCELLED', booking.cancellationReason ?? 'Booking cancelled', { cancelledBy: booking.cancelledBy });
        if (booking.payment) {
          push(`payment-${booking.payment.id}`, booking.payment.paidAt ?? booking.payment.createdAt, 'payment', `PAYMENT_${booking.payment.status}`, `Payment ${booking.payment.status.toLowerCase()}`, { amount: booking.payment.amount, invoice: booking.payment.invoiceNumber });
        }
        booking.disputes.forEach((dispute) => {
          push(`dispute-${dispute.id}`, dispute.createdAt, 'dispute', `DISPUTE_${dispute.status}`, `Dispute ${dispute.status.toLowerCase().replace('_', ' ')}`);
        });
        booking.ratings.forEach((rating) => {
          push(`rating-${rating.id}`, rating.createdAt, 'rating', 'RATING_SUBMITTED', `Rated ${rating.score}/5`);
        });
      }
    }

    events.sort((a, b) => b.at.getTime() - a.at.getTime());
    const start = (page - 1) * limit;
    return {
      events: events.slice(start, start + limit),
      total: events.length,
      page,
      limit,
    };
  }

  private toPublicSettings(row: {
    payfastMerchantKey?: string | null;
    smtpPassword?: string | null;
    smsApiKey?: string | null;
    defaultCommissionRate?: unknown;
    minimumPayoutAmount?: unknown;
    [key: string]: unknown;
  }) {
    return {
      ...row,
      defaultCommissionRate: Number(row.defaultCommissionRate ?? 0.15),
      minimumPayoutAmount: Number(row.minimumPayoutAmount ?? 100),
      payfastMerchantKey: this.maskSecret(row.payfastMerchantKey),
      smtpPassword: this.maskSecret(row.smtpPassword),
      smsApiKey: this.maskSecret(row.smsApiKey),
      secrets: {
        payfastMerchantKey: Boolean(row.payfastMerchantKey),
        smtpPassword: Boolean(row.smtpPassword),
        smsApiKey: Boolean(row.smsApiKey),
      },
    };
  }

  private sanitizeSettingsPatch(data: Record<string, unknown>, current: { payfastMerchantKey?: string | null; smtpPassword?: string | null; smsApiKey?: string | null }) {
    const patch: Record<string, unknown> = {};
    for (const key of SETTINGS_WRITABLE) {
      if (data[key] === undefined) continue;
      if (SETTINGS_SECRETS.has(key) && this.isMaskedOrEmpty(data[key])) continue;
      patch[key] = data[key];
    }
    if (patch['defaultCommissionRate'] != null) {
      const rate = Number(patch['defaultCommissionRate']);
      if (Number.isNaN(rate) || rate < 0 || rate > 0.5) {
        throw new BadRequestException('Commission rate must be between 0% and 50%');
      }
      patch['defaultCommissionRate'] = rate;
    }
    if (patch['minimumPayoutAmount'] != null) {
      const amount = Number(patch['minimumPayoutAmount']);
      if (Number.isNaN(amount) || amount < 0) {
        throw new BadRequestException('Minimum payout must be a positive amount');
      }
      patch['minimumPayoutAmount'] = amount;
    }
    if (patch['sessionTimeoutMinutes'] != null) {
      const minutes = Number(patch['sessionTimeoutMinutes']);
      if (!Number.isInteger(minutes) || minutes < 5 || minutes > 1440) {
        throw new BadRequestException('Session timeout must be between 5 and 1440 minutes');
      }
    }
    if (patch['passwordMinLength'] != null) {
      const length = Number(patch['passwordMinLength']);
      if (!Number.isInteger(length) || length < 8 || length > 64) {
        throw new BadRequestException('Password minimum length must be between 8 and 64');
      }
    }
    if (patch['smtpPort'] != null) {
      patch['smtpPort'] = Number(patch['smtpPort']) || null;
    }
    void current;
    return patch;
  }

  private maskSecret(value?: string | null) {
    if (!value) return '';
    return value.length <= 4 ? '••••' : `••••${value.slice(-4)}`;
  }

  private isMaskedOrEmpty(value: unknown) {
    if (value == null || value === '') return true;
    return typeof value === 'string' && value.startsWith('••••');
  }
}

const SETTINGS_WRITABLE = [
  'timezone',
  'defaultCommissionRate',
  'minimumPayoutAmount',
  'paymentGatewayDefault',
  'payfastMerchantId',
  'payfastMerchantKey',
  'stripePublishableKey',
  'smtpHost',
  'smtpPort',
  'smtpUser',
  'smtpPassword',
  'smtpFromAddress',
  'smsProvider',
  'smsApiKey',
  'smsSenderId',
  'require2faForAdmins',
  'sessionTimeoutMinutes',
  'passwordMinLength',
] as const;

const SETTINGS_SECRETS = new Set(['payfastMerchantKey', 'smtpPassword', 'smsApiKey']);
