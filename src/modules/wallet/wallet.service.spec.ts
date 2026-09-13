import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WalletService } from './wallet.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('WalletService withdrawal flow', () => {
  let service: WalletService;
  let prisma: {
    wallet: {
      upsert: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
    };
    withdrawalRequest: {
      findFirst: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      findMany: jest.Mock;
    };
    $transaction: jest.Mock;
  };

  const configMock = { get: jest.fn() };

  beforeEach(async () => {
    prisma = {
      wallet: {
        upsert: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      withdrawalRequest: {
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        findMany: jest.fn(),
      },
      $transaction: jest.fn(async (cb: any) => cb({
        wallet: { update: jest.fn() },
        withdrawalRequest: { create: jest.fn() },
      })),
    };

    configMock.get.mockImplementation((key: string, fallback?: any) => {
      if (key === 'payment.minimumWithdrawal') return 100;
      return fallback;
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WalletService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: configMock },
      ],
    }).compile();

    service = module.get<WalletService>(WalletService);
  });

  afterEach(() => jest.clearAllMocks());

  it('reserves funds and creates a single pending withdrawal when available balance is sufficient', async () => {
    prisma.wallet.upsert.mockResolvedValue({ id: 'wallet-1', providerId: 'provider-1', balance: 500, pendingBalance: 0, reservedBalance: 0, totalEarned: 500, totalWithdrawn: 0, currency: 'ZAR' });
    prisma.withdrawalRequest.findFirst.mockResolvedValue(null);
    prisma.withdrawalRequest.create.mockResolvedValue({ id: 'wd-1', reference: 'WD-20260901-A82F91', status: 'PENDING' });

    const result = await service.requestWithdrawal('provider-1', 250, {
      bankName: 'First National Bank',
      accountNumber: '1234567890',
      accountHolder: 'John Runner',
      branchCode: '250655',
      bankCode: '250655',
    });

    expect(result.status).toBe('PENDING');
    expect(prisma.withdrawalRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          amount: 250,
          status: 'PENDING',
          reference: expect.any(String),
          currency: 'ZAR',
        }),
      }),
    );
  });

  it('rejects a withdrawal when the amount exceeds available balance', async () => {
    prisma.wallet.upsert.mockResolvedValue({ id: 'wallet-1', providerId: 'provider-1', balance: 100, pendingBalance: 0, reservedBalance: 0, totalEarned: 100, totalWithdrawn: 0, currency: 'ZAR' });

    await expect(service.requestWithdrawal('provider-1', 250, {
      bankName: 'Standard Bank',
      accountNumber: '1234567890',
      accountHolder: 'John Runner',
      branchCode: '632005',
      bankCode: '632005',
    })).rejects.toThrow(BadRequestException);

    expect(prisma.withdrawalRequest.create).not.toHaveBeenCalled();
  });
});
