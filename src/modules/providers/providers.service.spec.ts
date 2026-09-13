import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import { ProvidersService } from './providers.service';

describe('ProvidersService', () => {
  let service: ProvidersService;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      provider: {
        findMany: jest.fn().mockImplementation(async () => []),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      providerServiceCategory: {
        findMany: jest.fn(),
      },
      serviceCategory: {
        findUnique: jest.fn(),
      },
    };

    service = new ProvidersService(prisma);
  });

  it('filters hidden providers out of public listings', async () => {
    await service.findAll();

    expect(prisma.provider.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          isActive: true,
          isAvailable: true,
          isBanned: false,
          kycStatus: 'APPROVED',
        }),
      }),
    );
  });
});
