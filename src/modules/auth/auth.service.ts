import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import * as speakeasy from 'speakeasy';
import { EmailService } from '../../services/email/email.service';
import { SmsService } from '../../services/sms/sms.service';
import { RedisService } from '../../services/redis/redis.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { ALL_PERMISSIONS } from '../admin/permissions.catalog';
import { RegisterDto } from './dto/register.dto';
import { RegisterProviderDto } from './dto/register-provider.dto';
import { LoginDto } from './dto/login.dto';
import { AppleSignInDto } from './dto/apple-signin.dto';
import { AppleTokenVerifier } from './apple-token.verifier';

type AccountType = 'user' | 'provider' | 'admin';
type OAuthRole = 'user' | 'provider';

type OAuthProfile = {
  email: string;
  firstName: string;
  lastName: string;
  avatarUrl?: string;
  provider: string;
  providerAccountId: string;
};

const OAUTH_EXCHANGE_TTL_SECONDS = 120;
const OAUTH_SELECTION_TTL_SECONDS = 300;

const PROVIDER_LOGIN_INCLUDE = {
  serviceCategories: { include: { category: true } },
  wallet: true,
  currentLocation: true,
  _count: { select: { bookingsAsProvider: { where: { status: 'COMPLETED' as const } } } },
} as const;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly email: EmailService,
    private readonly sms: SmsService,
    private readonly redis: RedisService,
    private readonly audit: AuditService,
    private readonly appleVerifier: AppleTokenVerifier,
  ) {}

  async registerUser(dto: RegisterDto) {
    const email = dto.email.trim().toLowerCase();
    const existing = await this.prisma.user.findFirst({
      where: { OR: [{ email }, { phone: dto.phone }] },
    });
    if (existing) {
      throw new ConflictException(
        existing.email === email
          ? 'A customer account with this email already exists. Sign in, or create a provider account instead.'
          : 'A customer account with this phone already exists.',
      );
    }

    const rounds = this.config.get<number>('auth.bcryptRounds', 12);
    const passwordHash = await bcrypt.hash(dto.password, rounds);

    const user = await this.prisma.user.create({
      data: {
        email,
        phone: dto.phone,
        passwordHash,
        firstName: dto.firstName,
        lastName: dto.lastName,
        role: 'USER',
      },
    });

    this.sendEmailVerification(user.id, user.email, 'user').catch(() => null);
    if (dto.sendPhoneOtp) this.sendPhoneVerification(user.id, user.phone, 'user').catch(() => null);

    const tokens = await this.generateTokens(user.id, user.email, user.role, 'user');
    return { user: this.sanitizeUser(user), tokens };
  }

  async registerProvider(dto: RegisterProviderDto) {
    try {
      const email = dto.email.trim().toLowerCase();
      const existing = await this.prisma.provider.findFirst({
        where: { OR: [{ email }, { phone: dto.phone }] },
      });
      if (existing) {
        throw new ConflictException(
          existing.email === email
            ? 'A provider account with this email already exists. Sign in, or create a customer account instead.'
            : 'A provider account with this phone already exists.',
        );
      }

      const rounds = this.config.get<number>('auth.bcryptRounds', 12);
      const passwordHash = await bcrypt.hash(dto.password, rounds);

      const provider = await this.prisma.provider.create({
        data: {
          email,
          phone: dto.phone,
          passwordHash,
          firstName: dto.firstName,
          lastName: dto.lastName,
          bio: dto.bio,
        },
      });

      try {
        await this.sendEmailVerification(provider.id, provider.email, 'provider');
      } catch (error) {
        this.logger.error(`Email verification failed for provider ${provider.email}`, error);
      }

      if (dto.sendPhoneOtp) {
        try {
          await this.sendPhoneVerification(provider.id, provider.phone, 'provider');
        } catch (error) {
          this.logger.error(`Phone verification failed for provider ${provider.email}`, error);
        }
      }

      const tokens = await this.generateTokens(provider.id, provider.email, 'PROVIDER', 'provider');
      return { provider: this.sanitizeProvider(provider), tokens };
    } catch (error) {
      this.logger.error('Register provider failed', error);
      throw error;
    }
  }

  async loginUser(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email.trim().toLowerCase() } });
    if (!user || !user.passwordHash) throw new UnauthorizedException('Invalid credentials');
    if (!user.isActive || user.isBanned) throw new UnauthorizedException('Account suspended');

    const valid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!valid) throw new UnauthorizedException('Invalid credentials');

    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

    if (user.isTwoFactorEnabled) {
      return { requiresTwoFactor: true, userId: user.id };
    }

    const tokens = await this.generateTokens(user.id, user.email, user.role, 'user');
    return { user: this.sanitizeUser(user), tokens };
  }

  async loginProvider(dto: LoginDto) {
    const provider = await this.prisma.provider.findUnique({ where: { email: dto.email.trim().toLowerCase() } });
    if (!provider || !provider.passwordHash) throw new UnauthorizedException('Invalid credentials');
    if (!provider.isActive || provider.isBanned) throw new UnauthorizedException('Account suspended');

    const valid = await bcrypt.compare(dto.password, provider.passwordHash);
    if (!valid) throw new UnauthorizedException('Invalid credentials');

    await this.prisma.provider.update({ where: { id: provider.id }, data: { lastLoginAt: new Date() } });

    const tokens = await this.generateTokens(provider.id, provider.email, 'PROVIDER', 'provider');
    return { provider: this.sanitizeProvider(provider), tokens };
  }

  async loginAdmin(dto: LoginDto) {
    const admin = await this.prisma.admin.findUnique({
      where: { email: dto.email.trim().toLowerCase() },
      include: { roleRef: true },
    });
    if (!admin || !admin.passwordHash) throw new UnauthorizedException('Invalid credentials');
    if (!admin.isActive || admin.isBanned) throw new UnauthorizedException('Account suspended');

    const valid = await bcrypt.compare(dto.password, admin.passwordHash);
    if (!valid) throw new UnauthorizedException('Invalid credentials');

    await this.prisma.admin.update({ where: { id: admin.id }, data: { lastLoginAt: new Date() } });

    if (admin.isTwoFactorEnabled) {
      return { requiresTwoFactor: true, userId: admin.id, type: 'admin' as const };
    }

    const tokens = await this.generateTokens(admin.id, admin.email, admin.role ?? 'ADMIN', 'admin');
    return { user: this.sanitizeAdmin(admin), tokens };
  }

  async setAdminPassword(adminId: string, newPassword: string) {
    const admin = await this.prisma.admin.findUnique({
      where: { id: adminId },
      include: { roleRef: true },
    });
    if (!admin || !admin.isActive || admin.isBanned) throw new UnauthorizedException('Invalid credentials');
    if (!admin.mustChangePassword) {
      throw new BadRequestException('This account does not require a password change');
    }

    const rounds = this.config.get<number>('auth.bcryptRounds', 12);
    const passwordHash = await bcrypt.hash(newPassword, rounds);
    const updated = await this.prisma.admin.update({
      where: { id: adminId },
      data: {
        passwordHash,
        mustChangePassword: false,
        inviteStatus: 'ACTIVE',
      },
      include: { roleRef: true },
    });

    await this.audit.log({
      actorId: adminId,
      actorType: 'admin',
      action: 'ADMIN_PASSWORD_SET',
      entityType: 'Admin',
      entityId: adminId,
    });

    const tokens = await this.generateTokens(updated.id, updated.email, updated.role ?? 'ADMIN', 'admin');
    return { user: this.sanitizeAdmin(updated), tokens };
  }

  async verifyAdminPassword(adminId: string, password: string, purpose?: string) {
    const admin = await this.prisma.admin.findUnique({ where: { id: adminId } });
    if (!admin?.passwordHash || !admin.isActive || admin.isBanned) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const valid = await bcrypt.compare(password, admin.passwordHash);
    if (!valid) throw new BadRequestException('Password is incorrect');

    await this.audit.log({
      actorId: adminId,
      actorType: 'admin',
      action: 'ADMIN_REAUTH',
      metadata: { purpose: purpose ?? 'SENSITIVE_ACTION' },
    });

    return { verified: true };
  }

  // ─── Admin password change (OTP first, then set a new password) ──────────────
  private readonly ADMIN_PW_CHANGE_OTP_MAX_ATTEMPTS = 5;

  private adminPwChangeOtpKey(adminId: string) {
    return `admin_pw_change_otp:${adminId}`;
  }
  private adminPwChangeGrantKey(adminId: string) {
    return `admin_pw_change_grant:${adminId}`;
  }

  /** Step 1 — email a one-time code to the signed-in admin. */
  async requestAdminPasswordChangeOtp(adminId: string) {
    const admin = await this.prisma.admin.findUnique({ where: { id: adminId } });
    if (!admin?.passwordHash || !admin.isActive || admin.isBanned) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresInMinutes = this.config.get<number>('auth.otpExpiryMinutes', 10);
    await this.redis.set(
      this.adminPwChangeOtpKey(adminId),
      JSON.stringify({ code, attempts: 0 }),
      expiresInMinutes * 60,
    );

    await this.email.sendPasswordChangeOtp(admin.email, admin.firstName, code);

    if (this.config.get('OTP_DEBUG_LOG') === 'true') {
      this.logger.log(`[OTP] Admin password-change code for ${admin.email}: ${code}`);
    }

    await this.audit.log({
      actorId: adminId,
      actorType: 'admin',
      action: 'ADMIN_PASSWORD_CHANGE_OTP_SENT',
      entityType: 'Admin',
      entityId: adminId,
    });

    return { message: 'A verification code has been emailed to you', expiresInMinutes };
  }

  /** Step 2 — verify the code; on success a short-lived grant lets step 3 through. */
  async verifyAdminPasswordChangeOtp(adminId: string, code: string) {
    const key = this.adminPwChangeOtpKey(adminId);
    const stored = await this.redis.get(key);
    if (!stored) throw new BadRequestException('Your verification has expired. Start again.');

    const data = JSON.parse(stored) as { code: string; attempts: number };
    if (data.attempts >= this.ADMIN_PW_CHANGE_OTP_MAX_ATTEMPTS) {
      await this.redis.del(key);
      throw new BadRequestException('Too many attempts. Start again.');
    }
    if (data.code !== code) {
      const expiresInMinutes = this.config.get<number>('auth.otpExpiryMinutes', 10);
      await this.redis.set(key, JSON.stringify({ ...data, attempts: data.attempts + 1 }), expiresInMinutes * 60);
      throw new BadRequestException('Invalid or expired code');
    }

    await this.redis.del(key);
    await this.redis.set(this.adminPwChangeGrantKey(adminId), '1', 15 * 60);

    await this.audit.log({
      actorId: adminId,
      actorType: 'admin',
      action: 'ADMIN_PASSWORD_CHANGE_OTP_VERIFIED',
      entityType: 'Admin',
      entityId: adminId,
    });

    return { verified: true };
  }

  /** Step 3 — set the new password (only within 15 min of a verified code). */
  async setAdminPasswordAfterOtp(adminId: string, newPassword: string) {
    const grantKey = this.adminPwChangeGrantKey(adminId);
    const grant = await this.redis.get(grantKey);
    if (!grant) throw new BadRequestException('Verify with the emailed code first.');

    const admin = await this.prisma.admin.findUnique({
      where: { id: adminId },
      include: { roleRef: true },
    });
    if (!admin?.passwordHash || !admin.isActive || admin.isBanned) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const samePassword = await bcrypt.compare(newPassword, admin.passwordHash);
    if (samePassword) throw new BadRequestException('New password must be different from the current one');

    const rounds = this.config.get<number>('auth.bcryptRounds', 12);
    const passwordHash = await bcrypt.hash(newPassword, rounds);
    const updated = await this.prisma.admin.update({
      where: { id: adminId },
      data: { passwordHash, mustChangePassword: false, inviteStatus: 'ACTIVE' },
      include: { roleRef: true },
    });

    await this.redis.del(grantKey);
    await this.logout(adminId, 'admin'); // invalidate the old refresh token / other sessions

    await this.audit.log({
      actorId: adminId,
      actorType: 'admin',
      action: 'ADMIN_PASSWORD_CHANGED',
      entityType: 'Admin',
      entityId: adminId,
    });

    const tokens = await this.generateTokens(updated.id, updated.email, updated.role ?? 'ADMIN', 'admin');
    return { user: this.sanitizeAdmin(updated), tokens };
  }

  async verifyTwoFactor(userId: string, code: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.twoFactorSecret) throw new BadRequestException('2FA not configured');

    const valid = speakeasy.totp.verify({
      secret: user.twoFactorSecret,
      encoding: 'base32',
      token: code,
      window: 1,
    });

    if (!valid) throw new UnauthorizedException('Invalid 2FA code');
    const tokens = await this.generateTokens(user.id, user.email, user.role, 'user');
    return { user: this.sanitizeUser(user), tokens };
  }

  async refreshTokens(id: string, refreshToken: string, type: AccountType = 'user') {
    const storedToken = await this.redis.get(`refresh_token:${type}:${id}`);
    if (!storedToken || storedToken !== refreshToken) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (type === 'provider') {
      const provider = await this.prisma.provider.findUniqueOrThrow({ where: { id } });
      return this.generateTokens(provider.id, provider.email, 'PROVIDER', 'provider');
    }

    if (type === 'admin') {
      const admin = await this.prisma.admin.findUniqueOrThrow({ where: { id } });
      return this.generateTokens(admin.id, admin.email, admin.role ?? 'ADMIN', 'admin');
    }

    const user = await this.prisma.user.findUniqueOrThrow({ where: { id } });
    return this.generateTokens(user.id, user.email, user.role, 'user');
  }

  async logout(id: string, type: AccountType = 'user') {
    await this.redis.del(`refresh_token:${type}:${id}`);
  }

  async verifyEmail(id: string, code: string, type: AccountType = 'user') {
    const storedCode = await this.redis.get(`email_otp:${type}:${id}`);
    if (!storedCode || storedCode !== code) throw new BadRequestException('Invalid or expired OTP');

    if (type === 'provider') {
      await this.prisma.provider.update({ where: { id }, data: { isEmailVerified: true } });
    } else if (type === 'admin') {
      await this.prisma.admin.update({ where: { id }, data: { isEmailVerified: true } });
    } else {
      await this.prisma.user.update({ where: { id }, data: { isEmailVerified: true } });
    }
    await this.redis.del(`email_otp:${type}:${id}`);
    return { message: 'Email verified successfully' };
  }

  async verifyPhone(id: string, code: string, type: AccountType = 'user') {
    const storedCode = await this.redis.get(`phone_otp:${type}:${id}`);
    if (!storedCode || storedCode !== code) throw new BadRequestException('Invalid or expired OTP');

    if (type === 'provider') {
      await this.prisma.provider.update({ where: { id }, data: { isPhoneVerified: true } });
    } else if (type === 'admin') {
      await this.prisma.admin.update({ where: { id }, data: { isPhoneVerified: true } });
    } else {
      await this.prisma.user.update({ where: { id }, data: { isPhoneVerified: true } });
    }
    await this.redis.del(`phone_otp:${type}:${id}`);
    return { message: 'Phone verified successfully' };
  }

  async forgotPassword(email: string, type: AccountType = 'user') {
    const normalizedEmail = email.trim().toLowerCase();
    this.logger.log(`[ForgotPassword] Requesting reset for email: ${normalizedEmail}, type: ${type}`);
    
    let account: any = null;
    let resolvedType: AccountType = type;

    if (type === 'user') {
      // Try to find user account
      account = await this.prisma.user.findUnique({ where: { email: normalizedEmail } });
      if (!account) {
        // If not found and no specific type was requested (default is 'user'), try provider
        this.logger.log(`[ForgotPassword] User account not found, trying provider...`);
        account = await this.prisma.provider.findUnique({ where: { email: normalizedEmail } });
        if (account) resolvedType = 'provider';
      }
      if (!account) {
        // Try admin as last resort
        this.logger.log(`[ForgotPassword] Provider account not found, trying admin...`);
        account = await this.prisma.admin.findUnique({ where: { email: normalizedEmail } });
        if (account) resolvedType = 'admin';
      }
    } else if (type === 'provider') {
      account = await this.prisma.provider.findUnique({ where: { email: normalizedEmail } });
    } else if (type === 'admin') {
      account = await this.prisma.admin.findUnique({ where: { email: normalizedEmail } });
    }

    if (!account) {
      this.logger.log(`[ForgotPassword] No account found for email: ${normalizedEmail}`);
      return { message: 'If that email is registered, a reset code has been sent' };
    }

    const otp = String(Math.floor(100000 + Math.random() * 900000));
    const expiryMinutes = this.config.get<number>('auth.otpExpiryMinutes', 10);
    const ttlSeconds = expiryMinutes * 60;
    const redisKey = `password_reset_otp:${resolvedType}:${account.id}`;
    
    this.logger.log(`[ForgotPassword] Generated OTP for ${account.email} (ID: ${account.id}, type: ${resolvedType}). OTP: ${otp}, Expiry: ${expiryMinutes}min (${ttlSeconds}sec), Redis Key: ${redisKey}`);
    
    try {
      await this.redis.set(redisKey, otp, ttlSeconds);
      this.logger.log(`[ForgotPassword] OTP stored in Redis successfully`);

      const verification = await this.redis.get(redisKey);
      if (verification === null) {
        this.logger.error(
          `[ForgotPassword] Redis did not persist the OTP for key ${redisKey}. Rejecting the reset request to avoid a broken flow.`,
        );
        throw new BadRequestException('Password reset could not be prepared. Please try again.');
      }

      if (verification === otp) {
        this.logger.log(`[ForgotPassword] ✓ Verification: OTP confirmed in Redis`);
      } else {
        this.logger.warn(`[ForgotPassword] OTP mismatch after Redis write; expected ${otp}, got ${verification}`);
      }
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      this.logger.error(`[ForgotPassword] ERROR storing OTP in Redis: ${err instanceof Error ? err.message : String(err)}`);
      throw err;
    }
    
    try {
      await this.email.sendPasswordResetOtp(account.email, account.firstName, otp);
      this.logger.log(`[ForgotPassword] Reset OTP email sent successfully to ${account.email}`);
    } catch (err) {
      this.logger.error(`[ForgotPassword] ERROR sending email: ${err instanceof Error ? err.message : String(err)}`);
      throw err;
    }

    return { message: 'If that email is registered, a reset code has been sent' };
  }

  async verifyForgotPasswordOtp(email: string, code: string) {
    const normalizedEmail = email.trim().toLowerCase();
    const normalizedCode = code.trim();

    this.logger.log(`[VerifyForgotPasswordOtp] Verifying OTP for email: ${normalizedEmail}, provided code: ${normalizedCode}`);

    const accountsByType: Array<{ type: AccountType; account: { id: string } }> = [];
    for (const candidate of [
      { type: 'user' as const, account: await this.prisma.user.findUnique({ where: { email: normalizedEmail } }) },
      { type: 'provider' as const, account: await this.prisma.provider.findUnique({ where: { email: normalizedEmail } }) },
      { type: 'admin' as const, account: await this.prisma.admin.findUnique({ where: { email: normalizedEmail } }) },
    ]) {
      if (candidate.account) {
        accountsByType.push({ type: candidate.type, account: { id: candidate.account.id } });
      }
    }

    if (accountsByType.length === 0) {
      this.logger.debug(`[VerifyForgotPasswordOtp] No user found for email: ${normalizedEmail}`);
      throw new BadRequestException('Invalid or expired reset code');
    }

    for (const { type, account } of accountsByType) {
      const redisKey = `password_reset_otp:${type}:${account.id}`;
      const storedCode = await this.redis.get(redisKey);
      this.logger.log(
        `[VerifyForgotPasswordOtp] ${type[0].toUpperCase() + type.slice(1)} found. Redis Key: ${redisKey}, Stored Code: ${storedCode}, Provided Code: ${normalizedCode}, Match: ${storedCode === normalizedCode}`,
      );

      if (storedCode && storedCode === normalizedCode) {
        return { valid: true, email: normalizedEmail, type };
      }
    }

    throw new BadRequestException('Invalid or expired reset code');
  }

  async resetPassword(token?: string, newPassword?: string, email?: string, otp?: string) {
    const normalizedNewPassword = newPassword?.trim();
    this.logger.log(`[ResetPassword] Called with - token: ${token ? 'yes' : 'no'}, email: ${email}, otp: ${otp ? 'yes' : 'no'}, newPassword: ${normalizedNewPassword ? 'yes' : 'no'}`);
    
    if (!normalizedNewPassword) {
      throw new BadRequestException('New password is required');
    }

    const isOtpValue = (value?: string) => typeof value === 'string' && /^\d{4,6}$/.test(value.trim());

    let trimmedEmail = email?.trim().toLowerCase();
    let normalizedOtp = otp?.trim();
    let legacyToken = token?.trim();

    if (!trimmedEmail && typeof token === 'string' && token.includes('@')) {
      trimmedEmail = token.trim().toLowerCase();
      legacyToken = undefined;
    }

    if (!normalizedOtp && typeof email === 'string' && isOtpValue(email)) {
      normalizedOtp = email.trim();
      trimmedEmail = token?.trim().toLowerCase();
      legacyToken = undefined;
    }

    if (!normalizedOtp && typeof otp === 'string' && isOtpValue(otp)) {
      normalizedOtp = otp.trim();
    }

    if (trimmedEmail || normalizedOtp) {
      if (!trimmedEmail || !normalizedOtp) {
        throw new BadRequestException('Email and OTP are required for the reset code flow');
      }

      this.logger.log(`[ResetPassword] OTP flow detected - Email: ${trimmedEmail}, OTP: ${normalizedOtp ? 'provided' : 'missing'}`);

      const accountsByType: Array<{ type: AccountType; account: { id: string } }> = [];
      for (const candidate of [
        { type: 'user' as const, account: await this.prisma.user.findUnique({ where: { email: trimmedEmail } }) },
        { type: 'provider' as const, account: await this.prisma.provider.findUnique({ where: { email: trimmedEmail } }) },
        { type: 'admin' as const, account: await this.prisma.admin.findUnique({ where: { email: trimmedEmail } }) },
      ]) {
        if (candidate.account) {
          accountsByType.push({ type: candidate.type, account: { id: candidate.account.id } });
        }
      }

      const matchingAccount = await (async () => {
        for (const { type, account } of accountsByType) {
          const storedCode = await this.redis.get(`password_reset_otp:${type}:${account.id}`);
          this.logger.log(
            `[ResetPassword] ${type} account found (ID: ${account.id}). Checking OTP - Stored: ${storedCode}, Provided: ${normalizedOtp}, Match: ${storedCode === normalizedOtp}`,
          );

          if (storedCode && storedCode === normalizedOtp) {
            return { type, account };
          }
        }

        return null;
      })();

      if (!matchingAccount) {
        this.logger.log(`[ResetPassword] No matching OTP found for email: ${trimmedEmail}`);
        throw new BadRequestException('Invalid or expired reset code');
      }

      const { type, account } = matchingAccount;
      const rounds = this.config.get<number>('auth.bcryptRounds', 12);
      const passwordHash = await bcrypt.hash(normalizedNewPassword, rounds);

      if (type === 'provider') {
        await this.prisma.provider.update({ where: { id: account.id }, data: { passwordHash } });
      } else if (type === 'admin') {
        await this.prisma.admin.update({ where: { id: account.id }, data: { passwordHash } });
      } else {
        await this.prisma.user.update({ where: { id: account.id }, data: { passwordHash } });
      }

      await this.redis.del(`password_reset_otp:${type}:${account.id}`);
      await this.logout(account.id, type);
      return { message: 'Password reset successfully' };
    }

    if (typeof legacyToken !== 'string' || !legacyToken) {
      throw new BadRequestException('Use the email OTP reset flow. Legacy token reset is no longer accepted without a valid token value.');
    }

    const stored = await this.redis.get(`password_reset:${legacyToken}`);
    if (!stored) throw new BadRequestException('Invalid or expired reset token');

    const [type, id] = stored.split(':') as [AccountType, string];
    const rounds = this.config.get<number>('auth.bcryptRounds', 12);
    const passwordHash = await bcrypt.hash(normalizedNewPassword, rounds);

    if (type === 'provider') {
      await this.prisma.provider.update({ where: { id }, data: { passwordHash } });
    } else if (type === 'admin') {
      await this.prisma.admin.update({ where: { id }, data: { passwordHash } });
    } else {
      await this.prisma.user.update({ where: { id }, data: { passwordHash } });
    }
    await this.redis.del(`password_reset:${legacyToken}`);
    await this.logout(id, type);

    return { message: 'Password reset successfully' };
  }

  async setupTwoFactor(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const secret = speakeasy.generateSecret({ name: `E-RRANDS (${user.email})`, length: 20 });
    await this.redis.set(`2fa_setup:${userId}`, secret.base32, 300);
    return { secret: secret.base32, otpauthUrl: secret.otpauth_url };
  }

  async enableTwoFactor(userId: string, code: string) {
    const secret = await this.redis.get(`2fa_setup:${userId}`);
    if (!secret) throw new BadRequestException('2FA setup expired, restart the process');

    const valid = speakeasy.totp.verify({ secret, encoding: 'base32', token: code, window: 1 });
    if (!valid) throw new UnauthorizedException('Invalid verification code');

    await this.prisma.user.update({
      where: { id: userId },
      data: { isTwoFactorEnabled: true, twoFactorSecret: secret },
    });
    await this.redis.del(`2fa_setup:${userId}`);
    return { message: '2FA enabled successfully' };
  }

  /**
   * Native Sign in with Apple (iOS). Verifies the identity token, then runs the
   * same identity-resolution path as Google/Facebook — so `requiresAccountSelection`
   * / `requiresAccountCreation` and the `/auth/oauth/select-account` +
   * `/auth/oauth/complete-signup` follow-ups all work unchanged.
   */
  async loginWithApple(dto: AppleSignInDto) {
    const identity = await this.appleVerifier.verify(dto.identityToken, dto.rawNonce);

    // Prefer the email from the verified token; fall back to the one the client
    // sent on first authorization.
    const email = (identity.email ?? dto.email ?? '').trim().toLowerCase();
    if (!email) {
      throw new BadRequestException(
        'Apple did not share an email address for this account. Enable it in your Apple ID settings and try again.',
      );
    }

    const profile: OAuthProfile = {
      provider: 'apple',
      providerAccountId: identity.sub,
      email,
      // Apple only sends the name on the very first authorization for this Apple
      // ID. Absent on every later sign-in (the account already exists by then).
      firstName: dto.fullName?.givenName?.trim() || '',
      lastName: dto.fullName?.familyName?.trim() || '',
    };

    return this.handleOAuthLogin(profile);
  }

  /**
   * Resolves social login from identity only — the client never chooses a role.
   * Existing accounts are detected by email / linked OAuth id. New identities must
   * pick a type after Google/Facebook (completeOAuthSignup). Dual accounts must
   * pick which dashboard to open (selectOAuthAccount).
   */
  async handleOAuthLogin(profile: OAuthProfile) {
    const normalized = this.normalizeOAuthProfile(profile);
    const [user, provider] = await Promise.all([
      this.findUserForOAuth(normalized),
      this.findProviderForOAuth(normalized),
    ]);

    const userOk = this.isUsableAccount(user);
    const providerOk = this.isUsableAccount(provider);

    if (!userOk && !providerOk) {
      if (user || provider) {
        throw new UnauthorizedException('Your account has been suspended. Please contact support.');
      }

      // Google / Apple are sign-in only — they carry too little profile data to
      // stand up a real account. New users must register first.
      return { requiresSignup: true as const };
    }

    if (userOk && providerOk && user && provider) {
      const selectionToken = crypto.randomUUID().replace(/-/g, '');
      await this.redis.set(
        `oauth_selection:${selectionToken}`,
        JSON.stringify({ userId: user.id, providerId: provider.id }),
        OAUTH_SELECTION_TTL_SECONDS,
      );
      return {
        requiresAccountSelection: true as const,
        selectionToken,
        availableAccounts: ['user', 'provider'] as OAuthRole[],
      };
    }

    if (userOk && user) {
      return this.completeUserOAuthSession(user);
    }

    return this.completeProviderOAuthSession(provider!.id);
  }

  async selectOAuthAccount(selectionToken: string, accountType: OAuthRole) {
    const raw = await this.redis.get(`oauth_selection:${selectionToken}`);
    if (!raw) {
      throw new BadRequestException('This account selection has expired. Please sign in again.');
    }

    const { userId, providerId } = JSON.parse(raw) as { userId: string; providerId: string };
    await this.redis.del(`oauth_selection:${selectionToken}`);

    if (accountType === 'provider') {
      return this.completeProviderOAuthSession(providerId);
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException('Account not found');
    }
    return this.completeUserOAuthSession(user);
  }

  async completeOAuthSignup(_creationToken: string, _role: OAuthRole): Promise<never> {
    // Account creation via Google / Apple is disabled — those sign-ins don't
    // provide enough profile data. Users register first, then link social login.
    throw new ForbiddenException(
      'Creating an account with Google or Apple is not available. Please sign up first.',
    );
  }

  private normalizeOAuthProfile(profile: OAuthProfile): OAuthProfile {
    const email = profile.email?.trim().toLowerCase() ?? '';
    if (!email) {
      throw new BadRequestException('Your social account did not provide an email address.');
    }
    return { ...profile, email };
  }

  private oauthIdentityFilter(profile: OAuthProfile) {
    return {
      OR: [
        { email: profile.email },
        { oauthAccounts: { some: { provider: profile.provider, providerAccountId: profile.providerAccountId } } },
      ],
    };
  }

  private findUserForOAuth(profile: OAuthProfile) {
    return this.prisma.user.findFirst({ where: this.oauthIdentityFilter(profile) });
  }

  private findProviderForOAuth(profile: OAuthProfile) {
    return this.prisma.provider.findFirst({ where: this.oauthIdentityFilter(profile) });
  }

  private isUsableAccount(account: { isActive: boolean; isBanned: boolean } | null | undefined): boolean {
    return Boolean(account && account.isActive && !account.isBanned);
  }

  private assertAccountUsable(account: { isActive: boolean; isBanned: boolean } | null | undefined) {
    if (!account || !this.isUsableAccount(account)) {
      throw new UnauthorizedException('Your account has been suspended. Please contact support.');
    }
  }

  private async findOAuthAccount(profile: OAuthProfile) {
    return this.prisma.oAuthAccount.findUnique({
      where: {
        provider_providerAccountId: {
          provider: profile.provider,
          providerAccountId: profile.providerAccountId,
        },
      },
    });
  }

  private async linkOAuthAccount(profile: OAuthProfile, ids: { userId?: string; providerId?: string }) {
    const existing = await this.findOAuthAccount(profile);
    if (!existing) {
      await this.prisma.oAuthAccount.create({
        data: {
          provider: profile.provider,
          providerAccountId: profile.providerAccountId,
          userId: ids.userId,
          providerId: ids.providerId,
        },
      });
      return;
    }

    await this.prisma.oAuthAccount.update({
      where: { id: existing.id },
      data: {
        ...(ids.userId && !existing.userId ? { userId: ids.userId } : {}),
        ...(ids.providerId && !existing.providerId ? { providerId: ids.providerId } : {}),
      },
    });
  }

  private async createUserFromOAuth(profile: OAuthProfile) {
    const user = await this.prisma.user.create({
      data: {
        email: profile.email,
        phone: `oauth_${profile.providerAccountId}`,
        firstName: profile.firstName,
        lastName: profile.lastName,
        avatarUrl: profile.avatarUrl,
        isEmailVerified: true,
      },
    });
    await this.linkOAuthAccount(profile, { userId: user.id });
    return this.completeUserOAuthSession(user);
  }

  private async createProviderFromOAuth(profile: OAuthProfile) {
    const provider = await this.prisma.provider.create({
      data: {
        email: profile.email,
        phone: `oauth_${profile.providerAccountId}`,
        firstName: profile.firstName,
        lastName: profile.lastName,
        avatarUrl: profile.avatarUrl,
        isEmailVerified: true,
      },
    });
    await this.linkOAuthAccount(profile, { providerId: provider.id });
    return this.completeProviderOAuthSession(provider.id);
  }

  private async completeUserOAuthSession(user: {
    id: string;
    email: string;
    phone: string;
    firstName: string;
    lastName: string;
    avatarUrl: string | null;
    role: string;
    isEmailVerified: boolean;
    isPhoneVerified: boolean;
    isTwoFactorEnabled: boolean;
    isActive: boolean;
    isBanned: boolean;
    lastLoginAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
    this.assertAccountUsable(user);
    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    const tokens = await this.generateTokens(user.id, user.email, user.role, 'user');
    return { accountType: 'user' as const, user: this.sanitizeUser(user), tokens };
  }

  private async completeProviderOAuthSession(providerId: string) {
    const provider = await this.prisma.provider.findUnique({
      where: { id: providerId },
      include: PROVIDER_LOGIN_INCLUDE,
    });
    if (!provider) {
      throw new UnauthorizedException('Account not found');
    }
    this.assertAccountUsable(provider);

    await this.prisma.provider.update({ where: { id: provider.id }, data: { lastLoginAt: new Date() } });
    const tokens = await this.generateTokens(provider.id, provider.email, 'PROVIDER', 'provider');

    return {
      accountType: 'provider' as const,
      provider: {
        ...this.sanitizeProvider(provider),
        serviceCategories: provider.serviceCategories.map((sc) => ({
          id: sc.category.id,
          name: sc.category.name,
          slug: sc.category.slug,
          basePrice: sc.basePrice !== null ? Number(sc.basePrice) : null,
          priceUnit: sc.priceUnit,
        })),
        wallet: provider.wallet
          ? { balance: Number(provider.wallet.balance), pendingBalance: Number(provider.wallet.pendingBalance), currency: provider.wallet.currency }
          : null,
        currentLocation: provider.currentLocation ? { address: provider.currentLocation.address ?? null } : null,
        completedJobsCount: provider._count.bookingsAsProvider,
      },
      tokens,
      requiresOnboarding: provider.kycStatus !== 'APPROVED',
    };
  }

  async createOAuthExchangeCode(payload: unknown): Promise<string> {
    const code = crypto.randomUUID().replace(/-/g, '');
    await this.redis.set(`oauth_exchange:${code}`, JSON.stringify(payload), OAUTH_EXCHANGE_TTL_SECONDS);
    return code;
  }

  async consumeOAuthExchangeCode(code: string): Promise<unknown | null> {
    const raw = await this.redis.get(`oauth_exchange:${code}`);
    if (!raw) return null;
    await this.redis.del(`oauth_exchange:${code}`);
    return JSON.parse(raw);
  }

  private async generateTokens(id: string, email: string, role: string, type: AccountType) {
    const normalizedRole = type === 'admin' ? role.toUpperCase() : role;
    const payload = { sub: id, email, role: normalizedRole, type };
    const [accessToken, refreshToken] = await Promise.all([
      this.jwt.signAsync(payload, {
        secret: this.config.get('auth.jwtSecret'),
        expiresIn: this.config.get('auth.jwtExpiresIn', '15m'),
      }),
      this.jwt.signAsync(payload, {
        secret: this.config.get('auth.jwtRefreshSecret'),
        expiresIn: this.config.get('auth.jwtRefreshExpiresIn', '7d'),
      }),
    ]);

    await this.redis.set(`refresh_token:${type}:${id}`, refreshToken, 7 * 24 * 60 * 60);
    return { accessToken, refreshToken, expiresIn: 900 };
  }

  private async sendEmailVerification(id: string, email: string, type: AccountType) {
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiryMinutes = this.config.get<number>('auth.otpExpiryMinutes', 10);
    await this.redis.set(`email_otp:${type}:${id}`, code, expiryMinutes * 60);

    // OTP_DEBUG_LOG is independent of NODE_ENV so codes can still be read from
    // Azure's Log Stream while no real SMTP provider is configured — remove once
    // SendGrid is wired up.
    if (this.config.get('OTP_DEBUG_LOG') === 'true') {
      this.logger.log(`[OTP] Email verification code for ${email} (${type}): ${code}`);
    }

    await this.email.sendEmailVerification(email, code);
  }

  async resendEmailVerification(id: string, email: string, type: AccountType) {
    await this.sendEmailVerification(id, email, type);
    return { message: 'Verification code resent' };
  }

  private async sendPhoneVerification(id: string, phone: string, type: AccountType) {
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiryMinutes = this.config.get<number>('auth.otpExpiryMinutes', 10);
    await this.redis.set(`phone_otp:${type}:${id}`, code, expiryMinutes * 60);

    if (this.config.get('OTP_DEBUG_LOG') === 'true') {
      this.logger.log(`[OTP] Phone verification code for ${phone} (${type}): ${code}`);
    }

    await this.sms.sendOtp(phone, code);
  }

  async resendPhoneVerification(id: string, phone: string, type: AccountType) {
    await this.sendPhoneVerification(id, phone, type);
    return { message: 'Verification code resent' };
  }

  private sanitizeUser(user: {
    id: string; email: string; phone: string; firstName: string; lastName: string;
    avatarUrl: string | null; role: string; isEmailVerified: boolean; isPhoneVerified: boolean;
    isTwoFactorEnabled: boolean; isActive: boolean; isBanned: boolean;
    lastLoginAt: Date | null; createdAt: Date; updatedAt: Date;
    passwordHash?: string | null; twoFactorSecret?: string | null;
  }) {
    const {
      id, email, phone, firstName, lastName, avatarUrl, role,
      isEmailVerified, isPhoneVerified, isTwoFactorEnabled, isActive, isBanned,
      lastLoginAt, createdAt, updatedAt,
    } = user;
    return {
      id, email, phone, firstName, lastName, avatarUrl, role,
      isEmailVerified, isPhoneVerified, isTwoFactorEnabled, isActive, isBanned,
      lastLoginAt, createdAt, updatedAt,
    };
  }

  private sanitizeProvider(provider: {
    id: string; email: string; phone: string; firstName: string; lastName: string;
    avatarUrl: string | null; isEmailVerified: boolean; isPhoneVerified: boolean;
    isActive: boolean; isBanned: boolean; kycStatus: string;
    bio?: string | null; avgRating?: unknown; totalRatings?: number; isAvailable?: boolean;
    lastLoginAt: Date | null; createdAt: Date; updatedAt: Date;
    passwordHash?: string | null;
  }) {
    const {
      id, email, phone, firstName, lastName, avatarUrl,
      isEmailVerified, isPhoneVerified, isActive, isBanned, kycStatus,
      bio, avgRating, totalRatings, isAvailable,
      lastLoginAt, createdAt, updatedAt,
    } = provider;
    return {
      id, email, phone, firstName, lastName, avatarUrl,
      isEmailVerified, isPhoneVerified, isActive, isBanned, kycStatus,
      bio: bio ?? null, avgRating: avgRating !== undefined ? Number(avgRating) : 0, totalRatings: totalRatings ?? 0, isAvailable: isAvailable ?? false,
      lastLoginAt, createdAt, updatedAt,
    };
  }

  private sanitizeAdmin(admin: {
    id: string; email: string; phone: string; firstName: string; lastName: string;
    avatarUrl: string | null; role: string; isEmailVerified: boolean; isPhoneVerified: boolean;
    isTwoFactorEnabled: boolean; isActive: boolean; isBanned: boolean;
    lastLoginAt: Date | null; createdAt: Date; updatedAt: Date;
    passwordHash?: string | null; twoFactorSecret?: string | null;
    roleId?: string | null;
    mustChangePassword?: boolean;
    inviteStatus?: string;
    roleRef?: { name: string; slug: string; permissions: string[]; isSystem: boolean } | null;
  }) {
    const access = this.resolveAdminAccess(admin);
    const {
      id, email, phone, firstName, lastName, avatarUrl, role,
      isEmailVerified, isPhoneVerified, isTwoFactorEnabled, isActive, isBanned,
      lastLoginAt, createdAt, updatedAt,
    } = admin;
    return {
      id, email, phone, firstName, lastName, avatarUrl, role,
      isEmailVerified, isPhoneVerified, isTwoFactorEnabled, isActive, isBanned,
      lastLoginAt, createdAt, updatedAt,
      roleId: admin.roleId ?? null,
      roleName: access.roleName,
      permissions: access.permissions,
      isSuperAdmin: access.isSuperAdmin,
      mustChangePassword: access.mustChangePassword,
      inviteStatus: admin.inviteStatus ?? 'ACTIVE',
    };
  }

  resolveAdminAccess(admin: {
    roleId?: string | null;
    mustChangePassword?: boolean;
    roleRef?: { name: string; slug: string; permissions: string[]; isSystem: boolean } | null;
  }) {
    const isSuperAdmin = Boolean(admin.roleRef?.isSystem) || !admin.roleId;
    return {
      isSuperAdmin,
      mustChangePassword: Boolean(admin.mustChangePassword),
      roleName: admin.roleRef?.name ?? (isSuperAdmin ? 'Super Admin' : 'Administrator'),
      permissions: isSuperAdmin ? [...ALL_PERMISSIONS] : (admin.roleRef?.permissions ?? []),
    };
  }

  async validateUserById(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user || !user.isActive || user.isBanned) throw new UnauthorizedException();
    return user;
  }

  async validateProviderById(id: string) {
    const provider = await this.prisma.provider.findUnique({ where: { id } });
    if (!provider || !provider.isActive || provider.isBanned) throw new UnauthorizedException();
    return provider;
  }

  async validateAdminById(id: string) {
    const admin = await this.prisma.admin.findUnique({
      where: { id },
      include: { roleRef: true },
    });
    if (!admin || !admin.isActive || admin.isBanned) throw new UnauthorizedException();
    return admin;
  }
}
