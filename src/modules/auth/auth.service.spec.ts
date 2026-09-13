import { jest, describe, expect, it } from '@jest/globals';
import type { Mock } from 'jest-mock';
import { BadRequestException, ConflictException, UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { PrismaService } from '../../prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { EmailService } from '../../services/email/email.service';
import { SmsService } from '../../services/sms/sms.service';
import { RedisService } from '../../services/redis/redis.service';
import { AuditService } from '../../common/audit/audit.service';
import * as bcrypt from 'bcryptjs';

jest.mock('bcryptjs', () => ({
  compare: jest.fn(),
  hash: jest.fn(),
}));

const oauthProfile = {
  email: 'jane@example.com',
  firstName: 'Jane',
  lastName: 'Doe',
  provider: 'google',
  providerAccountId: 'google-123',
};

function baseAccount(overrides: Record<string, unknown> = {}) {
  return {
    id: 'acc-1',
    email: 'jane@example.com',
    phone: '+27820000000',
    firstName: 'Jane',
    lastName: 'Doe',
    avatarUrl: null,
    role: 'USER',
    isEmailVerified: true,
    isPhoneVerified: false,
    isTwoFactorEnabled: false,
    isActive: true,
    isBanned: false,
    lastLoginAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    kycStatus: 'PENDING',
    serviceCategories: [],
    wallet: null,
    currentLocation: null,
    _count: { bookingsAsProvider: 0 },
    ...overrides,
  };
}

function createService(prisma: unknown, redis?: Partial<RedisService>, emailOverrides: Partial<EmailService> = {}) {
  const jwtService = { signAsync: jest.fn<() => Promise<string>>().mockResolvedValue('signed-token') } as unknown as JwtService;
  const configService = { get: jest.fn((key: string, fallback?: unknown) => fallback) } as unknown as ConfigService;
  const redisService = {
    set: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    get: jest.fn<() => Promise<string | null>>().mockImplementation(async () => 'stored-otp'),
    del: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    ...redis,
  } as unknown as RedisService;
  const emailService = {
    sendPasswordReset: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    sendPasswordResetOtp: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    ...emailOverrides,
  } as unknown as EmailService;

  return new AuthService(
    prisma as PrismaService,
    jwtService,
    configService,
    emailService,
    {} as SmsService,
    redisService,
    { log: jest.fn<() => Promise<void>>().mockResolvedValue(undefined) } as unknown as AuditService,
    {} as any,
  );
}

describe('AuthService admin login', () => {
  it('authenticates an admin from the dedicated admins table', async () => {
    const prisma = {
      admin: {
        findUnique: jest.fn<() => Promise<any>>().mockResolvedValue(
          baseAccount({ id: 'admin-1', email: 'admin@example.com', role: 'ADMIN', passwordHash: 'hashed-password' }),
        ),
        update: jest.fn<() => Promise<any>>().mockResolvedValue({}),
      },
    };

    (bcrypt.compare as unknown as Mock).mockImplementation(async () => true);

    const service = createService(prisma);
    const result = await service.loginAdmin({ email: 'admin@example.com', password: 'StrongPass123!' } as any);

    expect(prisma.admin.findUnique).toHaveBeenCalledWith({
      where: { email: 'admin@example.com' },
      include: { roleRef: true },
    });
    expect(result?.user?.email).toBe('admin@example.com');
    expect(result?.tokens?.accessToken).toBe('signed-token');
  });
});

describe('AuthService reset password OTP verification', () => {
  it('uses the provider reset-otp key for provider accounts', async () => {
    const provider = baseAccount({
      id: 'provider-1',
      email: 'provider@example.com',
      role: undefined,
    });
    const prisma = {
      provider: {
        findUnique: jest.fn<() => Promise<any>>().mockResolvedValue(provider),
      },
      admin: {
        findUnique: jest.fn<() => Promise<any>>().mockResolvedValue(null),
      },
      user: {
        findUnique: jest.fn<() => Promise<any>>().mockResolvedValue(null),
      },
    };
    const redis = {
      get: jest.fn<(...args: any[]) => Promise<string | null>>().mockImplementation(async (key: string) =>
        key === 'password_reset_otp:provider:provider-1' ? '123456' : null,
      ),
    };

    const service = createService(prisma, redis);
    await expect(service.verifyForgotPasswordOtp('provider@example.com', '123456')).resolves.toMatchObject({
      valid: true,
      email: 'provider@example.com',
      type: 'provider',
    });
  });

  it('prefers the account type with the matching Redis OTP when the same email exists across types', async () => {
    const user = baseAccount({ id: 'user-1', email: 'shared@example.com' });
    const provider = baseAccount({ id: 'provider-1', email: 'shared@example.com', role: undefined });
    const prisma = {
      user: {
        findUnique: jest.fn<() => Promise<any>>().mockResolvedValue(user),
      },
      provider: {
        findUnique: jest.fn<() => Promise<any>>().mockResolvedValue(provider),
      },
      admin: {
        findUnique: jest.fn<() => Promise<any>>().mockResolvedValue(null),
      },
    };
    const redis = {
      get: jest.fn<(...args: any[]) => Promise<string | null>>().mockImplementation(async (key: string) => {
        if (key === 'password_reset_otp:user:user-1') return '123456';
        if (key === 'password_reset_otp:provider:provider-1') return null;
        return null;
      }),
    };

    const service = createService(prisma, redis);
    await expect(service.verifyForgotPasswordOtp('shared@example.com', '123456')).resolves.toMatchObject({
      valid: true,
      email: 'shared@example.com',
      type: 'user',
    });
  });
});

describe('AuthService OAuth login', () => {
  it('signs in a customer directly when only a user account exists', async () => {
    const user = baseAccount({ id: 'user-1' });
    const prisma = {
      user: {
        findFirst: jest.fn<() => Promise<any>>().mockResolvedValue(user),
        update: jest.fn<() => Promise<any>>().mockResolvedValue(user),
      },
      provider: {
        findFirst: jest.fn<() => Promise<any>>().mockResolvedValue(null),
      },
    };

    const service = createService(prisma);
    const result = await service.handleOAuthLogin(oauthProfile);

    expect(result).toMatchObject({ accountType: 'user', user: { id: 'user-1' } });
    expect(prisma.user.update).toHaveBeenCalled();
  });

  it('signs in a provider directly when only a provider account exists', async () => {
    const provider = baseAccount({ id: 'provider-1' });
    const prisma = {
      user: {
        findFirst: jest.fn<() => Promise<any>>().mockResolvedValue(null),
      },
      provider: {
        findFirst: jest.fn<() => Promise<any>>().mockResolvedValue(provider),
        findUnique: jest.fn<() => Promise<any>>().mockResolvedValue(provider),
        update: jest.fn<() => Promise<any>>().mockResolvedValue(provider),
      },
    };

    const service = createService(prisma);
    const result = await service.handleOAuthLogin(oauthProfile);

    expect(result).toMatchObject({ accountType: 'provider', requiresOnboarding: true });
  });

  it('asks the client to choose when both account types exist', async () => {
    const prisma = {
      user: {
        findFirst: jest.fn<() => Promise<any>>().mockResolvedValue(baseAccount({ id: 'user-1' })),
      },
      provider: {
        findFirst: jest.fn<() => Promise<any>>().mockResolvedValue(baseAccount({ id: 'provider-1' })),
      },
    };
    const redis = {
      set: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    };

    const service = createService(prisma, redis);
    const result = await service.handleOAuthLogin(oauthProfile);

    expect(result).toMatchObject({
      requiresAccountSelection: true,
      availableAccounts: ['user', 'provider'],
    });
    expect(redis.set).toHaveBeenCalled();
  });

  it('does not invent an account type for a new social identity', async () => {
    const prisma = {
      user: {
        findFirst: jest.fn<() => Promise<any>>().mockResolvedValue(null),
      },
      provider: {
        findFirst: jest.fn<() => Promise<any>>().mockResolvedValue(null),
      },
    };
    const redis = {
      set: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    };

    const service = createService(prisma, redis);
    const result = await service.handleOAuthLogin(oauthProfile);

    expect(result).toMatchObject({ requiresAccountCreation: true });
    expect(redis.set).toHaveBeenCalled();
  });

  it('rejects a suspended sole account', async () => {
    const prisma = {
      user: {
        findFirst: jest.fn<() => Promise<any>>().mockResolvedValue(baseAccount({ isActive: false })),
      },
      provider: {
        findFirst: jest.fn<() => Promise<any>>().mockResolvedValue(null),
      },
    };

    const service = createService(prisma);
    await expect(service.handleOAuthLogin(oauthProfile)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('issues tokens for the account chosen after a dual-account social login', async () => {
    const user = baseAccount({ id: 'user-1' });
    const prisma = {
      user: {
        findUnique: jest.fn<() => Promise<any>>().mockResolvedValue(user),
        update: jest.fn<() => Promise<any>>().mockResolvedValue(user),
      },
    };
    const redis = {
      get: jest.fn<() => Promise<string | null>>().mockResolvedValue(JSON.stringify({ userId: 'user-1', providerId: 'provider-1' })),
      del: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    };

    const service = createService(prisma, redis);
    const result = await service.selectOAuthAccount('selection-token', 'user');

    expect(result).toMatchObject({ accountType: 'user', user: { id: 'user-1' } });
    expect(redis.del).toHaveBeenCalled();
  });

  it('creates the missing account type from a first-time social identity', async () => {
    const created = baseAccount({ id: 'user-new' });
    const prisma = {
      user: {
        findFirst: jest.fn<() => Promise<any>>().mockResolvedValue(null),
        create: jest.fn<() => Promise<any>>().mockResolvedValue(created),
        update: jest.fn<() => Promise<any>>().mockResolvedValue(created),
      },
      provider: {
        findFirst: jest.fn<() => Promise<any>>().mockResolvedValue(baseAccount({ id: 'provider-1' })),
      },
      oAuthAccount: {
        findUnique: jest.fn<() => Promise<any>>().mockResolvedValue({ id: 'oauth-1', userId: null, providerId: 'provider-1' }),
        update: jest.fn<() => Promise<any>>().mockResolvedValue({}),
      },
    };
    const redis = {
      get: jest.fn<() => Promise<string | null>>().mockResolvedValue(JSON.stringify(oauthProfile)),
      del: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    };

    const service = createService(prisma, redis);
    const result = await service.completeOAuthSignup('creation-token', 'user');

    expect(result).toMatchObject({ accountType: 'user', user: { id: 'user-new' } });
    expect(prisma.user.create).toHaveBeenCalled();
    expect(prisma.oAuthAccount.update).toHaveBeenCalled();
  });

  it('refuses to create a second account of the same type', async () => {
    const prisma = {
      user: {
        findFirst: jest.fn<() => Promise<any>>().mockResolvedValue(baseAccount({ id: 'user-1' })),
      },
      provider: {
        findFirst: jest.fn<() => Promise<any>>().mockResolvedValue(null),
      },
    };
    const redis = {
      get: jest.fn<() => Promise<string | null>>().mockResolvedValue(JSON.stringify(oauthProfile)),
    };

    const service = createService(prisma, redis);
    await expect(service.completeOAuthSignup('creation-token', 'user')).rejects.toBeInstanceOf(ConflictException);
  });

  it('sends a one-time reset code instead of a reset link', async () => {
    const user = baseAccount({ id: 'user-1', email: 'jane@example.com', firstName: 'Jane' });
    const prisma = {
      user: {
        findUnique: jest.fn<() => Promise<any>>().mockResolvedValue(user),
      },
    };
    const email = {
      sendPasswordResetOtp: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    } as unknown as EmailService;

    const service = createService(prisma, undefined, email);
    await service.forgotPassword('jane@example.com', 'user');

    expect(email.sendPasswordResetOtp).toHaveBeenCalledTimes(1);
    expect(email.sendPasswordResetOtp).toHaveBeenCalledWith('jane@example.com', 'Jane', expect.any(String));
  });

  it('resets a password with an email and OTP when a token is not provided', async () => {
    const prisma = {
      admin: { findUnique: jest.fn<() => Promise<any>>().mockResolvedValue(null) },
      provider: { findUnique: jest.fn<() => Promise<any>>().mockResolvedValue(null) },
      user: {
        findUnique: jest.fn<() => Promise<any>>().mockResolvedValue(baseAccount({ id: 'user-1', email: 'jane@example.com' })),
        update: jest.fn<() => Promise<any>>().mockResolvedValue(baseAccount({ id: 'user-1' })),
      },
    };
    const redis = {
      get: jest.fn<() => Promise<string | null>>().mockResolvedValue('123456'),
      del: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    };

    const service = createService(prisma, redis);
    await service.resetPassword('jane@example.com', 'StrongPass123!', '123456');

    expect(prisma.user.update).toHaveBeenCalled();
    expect(redis.del).toHaveBeenCalled();
  });
});

describe('AuthService password reset', () => {
  it('sends a one-time reset code instead of a reset link', async () => {
    const emailService = {
      sendPasswordResetOtp: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    };

    const prisma = {
      user: {
        findUnique: jest.fn<() => Promise<any>>().mockResolvedValue(baseAccount({ id: 'user-1', email: 'jane@example.com' })),
      },
      provider: {
        findUnique: jest.fn<() => Promise<any>>().mockResolvedValue(null),
      },
      admin: {
        findUnique: jest.fn<() => Promise<any>>().mockResolvedValue(null),
      },
    };

    const redis = {
      set: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
      get: jest.fn<() => Promise<string | null>>().mockResolvedValue('stored-otp'),
    };

    const jwtService = { signAsync: jest.fn<() => Promise<string>>().mockResolvedValue('signed-token') } as unknown as JwtService;
    const configService = { get: jest.fn((key: string, fallback?: unknown) => fallback) } as unknown as ConfigService;
    const service = new AuthService(
      prisma as unknown as PrismaService,
      jwtService,
      configService,
      emailService as unknown as EmailService,
      {} as SmsService,
      redis as unknown as RedisService,
      { log: jest.fn<() => Promise<void>>().mockResolvedValue(undefined) } as unknown as AuditService,
      {} as any,
    );

    await service.forgotPassword('jane@example.com', 'user');

    expect(emailService.sendPasswordResetOtp).toHaveBeenCalledTimes(1);
    expect(redis.set).toHaveBeenCalledWith('password_reset_otp:user:user-1', expect.any(String), 600);
  });

  it('rejects the reset request when Redis does not persist the OTP', async () => {
    const emailService = {
      sendPasswordResetOtp: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    };

    const prisma = {
      user: {
        findUnique: jest.fn<() => Promise<any>>().mockResolvedValue(baseAccount({ id: 'user-1', email: 'jane@example.com', firstName: 'Jane' })),
      },
      provider: {
        findUnique: jest.fn<() => Promise<any>>().mockResolvedValue(null),
      },
      admin: {
        findUnique: jest.fn<() => Promise<any>>().mockResolvedValue(null),
      },
    };

    const redis = {
      set: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
      get: jest.fn<() => Promise<string | null>>().mockResolvedValue(null),
    };

    const service = createService(prisma, redis, emailService as unknown as EmailService);

    await expect(service.forgotPassword('jane@example.com', 'user')).rejects.toBeInstanceOf(BadRequestException);
    expect(emailService.sendPasswordResetOtp).not.toHaveBeenCalled();
  });

  it('resets a password with an email and OTP when a token is not provided', async () => {
    const prisma = {
      admin: { findUnique: jest.fn<() => Promise<any>>().mockResolvedValue(null) },
      provider: { findUnique: jest.fn<() => Promise<any>>().mockResolvedValue(null) },
      user: {
        findUnique: jest.fn<() => Promise<any>>().mockResolvedValue(baseAccount({ id: 'user-1', email: 'jane@example.com' })),
        update: jest.fn<() => Promise<any>>().mockResolvedValue(baseAccount({ id: 'user-1' })),
      },
    };
    const redis = {
      get: jest.fn<() => Promise<string | null>>().mockResolvedValue('123456'),
      del: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    };

    const service = createService(prisma, redis);
    await service.resetPassword(undefined, 'StrongPass123!', 'jane@example.com', '123456');

    expect(prisma.user.update).toHaveBeenCalled();
    expect(redis.del).toHaveBeenCalled();
  });

  it('verifies a password reset OTP before accepting a new password', async () => {
    const prisma = {
      admin: { findUnique: jest.fn<() => Promise<any>>().mockResolvedValue(null) },
      provider: { findUnique: jest.fn<() => Promise<any>>().mockResolvedValue(null) },
      user: {
        findUnique: jest.fn<() => Promise<any>>().mockResolvedValue(baseAccount({ id: 'user-1', email: 'jane@example.com' })),
      },
    };
    const redis = {
      get: jest.fn<() => Promise<string | null>>().mockResolvedValue('123456'),
    };

    const service = createService(prisma, redis);
    await expect(service.verifyForgotPasswordOtp('jane@example.com', '123456')).resolves.toMatchObject({ valid: true });
    expect(redis.get).toHaveBeenCalledWith('password_reset_otp:user:user-1');
  });
});
