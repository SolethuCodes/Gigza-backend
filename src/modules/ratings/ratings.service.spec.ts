import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RatingsService } from './ratings.service';
import { maskFirstName } from './rating-display';

describe('RatingsService', () => {
  let service: RatingsService;

  const prismaMock: any = {
    booking: {
      findUniqueOrThrow: jest.fn(),
    },
    rating: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      aggregate: jest.fn(),
    },
    provider: {
      update: jest.fn(),
    },
    user: {
      update: jest.fn(),
    },
    service: {
      findMany: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RatingsService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: NotificationsService, useValue: { send: jest.fn(() => Promise.resolve()) } },
      ],
    }).compile();

    service = module.get<RatingsService>(RatingsService);
    jest.clearAllMocks();
  });

  it('rejects missing rating data before querying the database', async () => {
    await expect(service.create('user-1', {} as any)).rejects.toBeInstanceOf(BadRequestException);
    expect(prismaMock.booking.findUniqueOrThrow).not.toHaveBeenCalled();
  });

  it('rejects scores outside 1–5', async () => {
    await expect(service.create('user-1', { bookingId: 'booking-1', score: 6 })).rejects.toThrow(
      'score must be an integer between 1 and 5',
    );
    expect(prismaMock.booking.findUniqueOrThrow).not.toHaveBeenCalled();
  });

  it('creates a user-to-provider rating, persists serviceId, and updates provider aggregate', async () => {
    prismaMock.booking.findUniqueOrThrow.mockResolvedValue({
      id: 'booking-1',
      userId: 'user-1',
      providerId: 'provider-2',
      serviceId: 'service-9',
      status: 'COMPLETED',
    });
    prismaMock.rating.findFirst.mockResolvedValue(null);
    prismaMock.rating.create.mockResolvedValue({ id: 'rating-1', bookingId: 'booking-1', score: 5, serviceId: 'service-9' });
    prismaMock.rating.aggregate.mockResolvedValue({ _avg: { score: 5 }, _count: { score: 1 } });

    const result = await service.create('user-1', {
      bookingId: 'booking-1',
      score: 5,
      comment: 'Great work',
      photoUrls: ['https://example.com/photo.jpg'],
    });

    expect(prismaMock.rating.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        bookingId: 'booking-1',
        serviceId: 'service-9',
        fromUserId: 'user-1',
        toProviderId: 'provider-2',
        ratingFrom: 'USER_TO_PROVIDER',
        score: 5,
      }),
    }));
    expect(prismaMock.provider.update).toHaveBeenCalledWith({
      where: { id: 'provider-2' },
      data: { avgRating: 5, totalRatings: 1 },
    });
    expect(result).toEqual({ id: 'rating-1', bookingId: 'booking-1', score: 5, serviceId: 'service-9' });
  });

  it('creates a provider-to-user rating and updates user aggregate', async () => {
    prismaMock.booking.findUniqueOrThrow.mockResolvedValue({
      id: 'booking-1',
      userId: 'user-1',
      providerId: 'provider-2',
      serviceId: 'service-9',
      status: 'PAID',
    });
    prismaMock.rating.findFirst.mockResolvedValue(null);
    prismaMock.rating.create.mockResolvedValue({ id: 'rating-2', bookingId: 'booking-1', score: 4, serviceId: 'service-9' });
    prismaMock.rating.aggregate.mockResolvedValue({ _avg: { score: 4 }, _count: { score: 1 } });

    const result = await service.create('provider-2', {
      bookingId: 'booking-1',
      score: 4,
      comment: 'Reliable customer',
    });

    expect(prismaMock.rating.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        bookingId: 'booking-1',
        serviceId: 'service-9',
        fromProviderId: 'provider-2',
        toUserId: 'user-1',
        ratingFrom: 'PROVIDER_TO_USER',
        score: 4,
      }),
    }));
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { avgRating: 4, totalRatings: 1 },
    });
    expect(prismaMock.provider.update).not.toHaveBeenCalled();
    expect(result).toEqual({ id: 'rating-2', bookingId: 'booking-1', score: 4, serviceId: 'service-9' });
  });

  it('rejects ratings before the booking is completed', async () => {
    prismaMock.booking.findUniqueOrThrow.mockResolvedValue({
      id: 'booking-1',
      userId: 'user-1',
      providerId: 'provider-2',
      status: 'IN_PROGRESS',
    });

    await expect(service.create('provider-2', { bookingId: 'booking-1', score: 5 }))
      .rejects.toThrow('A booking must be completed before it can be rated');
    expect(prismaMock.rating.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.rating.create).not.toHaveBeenCalled();
  });

  it('returns anonymized provider ratings without reviewer ids or full names', async () => {
    prismaMock.rating.findMany.mockResolvedValue([
      {
        id: 'rating-1',
        score: 5,
        comment: 'Great',
        createdAt: new Date('2026-09-01T10:00:00.000Z'),
        serviceId: 'service-9',
        fromUserId: 'user-secret',
        fromUser: { firstName: 'John' },
      },
    ]);
    prismaMock.service.findMany.mockResolvedValue([{ id: 'service-9', name: 'House cleaning' }]);

    const result = await service.getForProvider('provider-2');

    expect(result).toEqual([
      {
        id: 'rating-1',
        score: 5,
        comment: 'Great',
        createdAt: new Date('2026-09-01T10:00:00.000Z'),
        serviceId: 'service-9',
        serviceName: 'House cleaning',
        reviewerDisplayName: 'Jo**',
      },
    ]);
    expect(JSON.stringify(result)).not.toContain('user-secret');
    expect(JSON.stringify(result)).not.toContain('John');
  });

  it('returns anonymized customer ratings using the provider first name', async () => {
    prismaMock.rating.findMany.mockResolvedValue([
      {
        id: 'rating-3',
        score: 5,
        comment: null,
        createdAt: new Date('2026-09-02T10:00:00.000Z'),
        serviceId: 'service-9',
        fromProvider: { firstName: 'Al' },
      },
    ]);
    prismaMock.service.findMany.mockResolvedValue([{ id: 'service-9', name: 'House cleaning' }]);

    const result = await service.getForCustomer('user-1');

    expect(result[0].reviewerDisplayName).toBe('Al');
    expect(result[0].score).toBe(5);
  });

  it('filters service ratings to that listing only', async () => {
    prismaMock.rating.findMany.mockResolvedValue([]);
    prismaMock.service.findMany.mockResolvedValue([]);

    await service.getForService('service-9');

    expect(prismaMock.rating.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { serviceId: 'service-9', ratingFrom: 'USER_TO_PROVIDER', isVisible: true },
    }));
  });
});

describe('maskFirstName', () => {
  it('masks remaining letters after the first two characters', () => {
    expect(maskFirstName('John')).toBe('Jo**');
    expect(maskFirstName('Al')).toBe('Al');
    expect(maskFirstName('A')).toBe('A');
    expect(maskFirstName('')).toBe('**');
  });
});
