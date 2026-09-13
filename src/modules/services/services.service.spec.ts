import { BadRequestException } from '@nestjs/common';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ServicesService } from './services.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('ServicesService', () => {
  let service: ServicesService;
  let prisma: { serviceCategory: any; providerServiceCategory: any; service: any };

  beforeEach(() => {
    prisma = {
      serviceCategory: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
      },
      providerServiceCategory: {
        upsert: jest.fn(),
      },
      service: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
    };

    service = new ServicesService(prisma as unknown as PrismaService);
  });

  it('creates a category when a provider creates a service without one', async () => {
    prisma.serviceCategory.findFirst.mockResolvedValue(null);
    prisma.serviceCategory.create.mockResolvedValue({ id: 'cat-1', name: 'Cleaning', slug: 'cleaning' });
    prisma.providerServiceCategory.upsert.mockResolvedValue({ id: 'psc-1' });
    prisma.service.create.mockResolvedValue({ id: 'service-1', name: 'Home Cleaning' });

    await service.createForProvider('provider-1', {
      name: 'Home Cleaning',
      description: 'Deep cleaning',
      categoryName: 'Cleaning',
      basePrice: 50,
    }, 'provider-1');

    expect(prisma.serviceCategory.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ name: 'Cleaning', slug: 'cleaning' }) }));
    expect(prisma.providerServiceCategory.upsert).toHaveBeenCalled();
    expect(prisma.service.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ providerId: 'provider-1' }) }));
  });

  it('rejects service creation when neither categoryId nor categoryName is supplied', async () => {
    await expect(service.createForProvider('provider-1', { name: 'Home Cleaning', description: 'Deep cleaning', basePrice: 50 }, 'provider-1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects service creation when the provided categoryId does not exist', async () => {
    prisma.serviceCategory.findUnique.mockResolvedValue(null);

    await expect(service.createForProvider('provider-1', { name: 'Home Cleaning', description: 'Deep cleaning', categoryId: 'missing-category', basePrice: 50 }, 'provider-1')).rejects.toBeInstanceOf(BadRequestException);
  });
});
