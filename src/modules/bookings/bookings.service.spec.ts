/// <reference types="jest" />
import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { plainToInstance } from 'class-transformer';
import { BookingsService } from './bookings.service';
import { PrismaService } from '../../prisma/prisma.service';
import { WebsocketsGateway } from '../websockets/websockets.gateway';
import { NotificationsService } from '../notifications/notifications.service';
import { PaymentsService } from '../payments/payments.service';
import { CreateBookingDto } from './dto/create-booking.dto';

describe('BookingsService', () => {
  let service: BookingsService;
  const mockBooking = {
    id: 'booking-1',
    serviceId: 'service-1',
    userId: 'user-1',
    providerId: 'provider-1',
    quotedPrice: 200,
    status: 'PENDING',
    estimatedDuration: 120,
    request: { id: 'request-1', latitude: 0, longitude: 0 },
    user: { firstName: 'Jane', lastName: 'Doe' },
    provider: { firstName: 'John', lastName: 'Smith', currentLocation: { latitude: 0, longitude: 0 } },
    payment: { status: 'PENDING' },
  };

  const prismaMock = {
    $transaction: jest.fn().mockResolvedValue([]),
    booking: {
      create: jest.fn().mockResolvedValue(mockBooking),
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(mockBooking),
      findUniqueOrThrow: jest.fn().mockResolvedValue(mockBooking),
      update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ ...mockBooking, ...data })),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    provider: {
      findUnique: jest.fn().mockResolvedValue({ kycStatus: 'APPROVED', isActive: true, isBanned: false }),
    },
    service: {
      findUnique: jest.fn().mockResolvedValue({ id: 'service-1', name: 'Test Service', pricingType: 'FLAT', unitLabel: null }),
      findMany: jest.fn().mockResolvedValue([{ id: 'service-1', name: 'Test Service', pricingType: 'FLAT', unitLabel: null }]),
    },
    payment: {
      create: jest.fn().mockResolvedValue({ id: 'payment-1', status: 'PENDING' }),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      findUnique: jest.fn().mockResolvedValue({ id: 'payment-1', status: 'COMPLETED', paymentMethod: 'CARD' }),
      update: jest.fn().mockResolvedValue({ id: 'payment-1', status: 'COMPLETED', paymentMethod: 'CASH' }),
    },
    adminSettings: {
      findUnique: jest.fn().mockResolvedValue({ defaultCommissionRate: 0.15 }),
    },
    conversation: {
      upsert: jest.fn().mockResolvedValue({}),
    },
    bookingCompletionToken: {
      upsert: jest.fn().mockResolvedValue({}),
      findUnique: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };

  const wsMock = {
    emitBookingUpdate: jest.fn(),
    emitNotification: jest.fn(),
    emitNewRequest: jest.fn(),
  };

  const notificationsMock = {
    send: jest.fn().mockResolvedValue(undefined),
  };

  const paymentsMock = {
    getBreakdown: jest.fn().mockResolvedValue({
      basePrice: 200,
      serviceFee: 0,
      platformFee: 30,
      totalAmount: 200,
      commissionRate: 0.15,
      commissionAmount: 30,
      providerEarnings: 170,
      currency: 'ZAR',
    }),
    releasePaymentToProvider: jest.fn().mockResolvedValue({ status: 'RELEASED', message: 'Payout released to provider' }),
  };

  const configMock = {
    get: jest.fn().mockImplementation((key: string) => {
      if (key === 'auth.jwtSecret') return 'test-jwt-secret';
      return 0.15;
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BookingsService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: ConfigService, useValue: configMock },
        { provide: WebsocketsGateway, useValue: wsMock },
        { provide: NotificationsService, useValue: notificationsMock },
        { provide: PaymentsService, useValue: paymentsMock },
      ],
    }).compile();

    service = module.get<BookingsService>(BookingsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('maps booking address and coordinates from the DTO payload', () => {
    const dto = plainToInstance(CreateBookingDto, {
      serviceId: 'service-1',
      providerId: 'provider-1',
      quotedPrice: 200,
      address: '123 Main Road, Cape Town',
      latitude: -33.9249,
      longitude: 18.4241,
    });

    expect(dto.address).toBe('123 Main Road, Cape Town');
    expect(dto.latitude).toBe(-33.9249);
    expect(dto.longitude).toBe(18.4241);
  });

  it('creates a booking and returns confirmation details with payment and ETA', async () => {
    const result = await service.create('user-1', {
      serviceId: 'service-1',
      providerId: 'provider-1',
      quotedPrice: 200,
      estimatedDuration: 120,
      notes: 'Please bring your own tools',
      preferredDate: '2026-07-25',
      preferredTimeSlot: '10:00-12:00',
      address: '123 Main Road, Cape Town',
      latitude: -33.9249,
      longitude: 18.4241,
    }) as any;

    expect(prismaMock.booking.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        userId: 'user-1',
        serviceId: 'service-1',
        status: { in: ['PENDING', 'ACCEPTED', 'IN_PROGRESS', 'DISPUTED'] },
      }),
    }));
    expect(prismaMock.booking.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        preferredDate: '2026-07-25',
        preferredTimeSlot: '10:00-12:00',
        address: '123 Main Road, Cape Town',
        latitude: -33.9249,
        longitude: 18.4241,
      }),
    }));
    expect(prismaMock.payment.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        bookingId: 'booking-1',
        providerId: 'provider-1',
        amount: 200,
        status: 'PENDING',
        paymentMethod: 'CARD',
        paymentGateway: 'MANUAL',
      }),
    }));
    expect(result.paymentStatus).toBe('PENDING');
    expect(result.pricingBreakdown).toEqual(expect.objectContaining({ basePrice: 200, totalAmount: 200, currency: 'ZAR' }));
    expect(result.estimatedArrivalTime).toBeDefined();
    expect(result.estimatedDuration).toBe(120);
  });

  it('prevents creating another active booking for the same user and service', async () => {
    prismaMock.booking.findFirst.mockResolvedValueOnce(mockBooking);

    await expect(service.create('user-1', {
      serviceId: 'service-1',
      providerId: 'provider-1',
      quotedPrice: 200,
      estimatedDuration: 120,
      notes: 'Please bring your own tools',
      preferredDate: '2026-07-25',
      preferredTimeSlot: '10:00-12:00',
    })).rejects.toBeInstanceOf(BadRequestException);

    expect(prismaMock.booking.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        userId: 'user-1',
        serviceId: 'service-1',
        status: { in: ['PENDING', 'ACCEPTED', 'IN_PROGRESS', 'DISPUTED'] },
      }),
    }));
    expect(prismaMock.booking.create).not.toHaveBeenCalled();
  });

  it('creates a cash payment row when the buyer chooses cash', async () => {
    await service.create('user-1', {
      serviceId: 'service-1',
      providerId: 'provider-1',
      quotedPrice: 200,
      paymentCategory: 'cash',
    });

    expect(prismaMock.payment.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        paymentMethod: 'CASH',
        paymentGateway: 'MANUAL',
        status: 'PENDING',
      }),
    }));
  });

  it('returns booking details with pricing breakdown and payment status', async () => {
    const result = await service.findOne('booking-1') as any;

    expect(prismaMock.booking.findUniqueOrThrow).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'booking-1' } }));
    expect(paymentsMock.getBreakdown).toHaveBeenCalledWith('booking-1');
    expect(result.paymentStatus).toBe('PENDING');
    expect(result.pricingBreakdown).toEqual(expect.objectContaining({ basePrice: 200, totalAmount: 200, currency: 'ZAR' }));
    expect(result.estimatedArrivalTime).toBeDefined();
  });

  it('accepts a booking and sends notifications to both parties', async () => {
    const result = await service.updateStatus('booking-1', 'provider-1', 'accepted') as any;

    expect(result.status).toBe('ACCEPTED');
    expect(result.acceptedAt).toBeInstanceOf(Date);
    expect(notificationsMock.send).toHaveBeenCalledTimes(2);
    expect(wsMock.emitNotification).toHaveBeenCalledTimes(2);
    expect(wsMock.emitBookingUpdate).toHaveBeenCalledWith('booking-1', 'user-1', 'provider-1', 'ACCEPTED');
  });

  it('declines a booking with a reason and saves decline metadata', async () => {
    const result = await service.updateStatus('booking-1', 'provider-1', 'declined', 'Not available') as any;

    expect(result.status).toBe('DECLINED');
    expect(result.cancellationReason).toBe('Not available');
    expect(result.cancelledBy).toBe('provider-1');
    expect(notificationsMock.send).toHaveBeenCalledTimes(2);
    expect(wsMock.emitNotification).toHaveBeenCalledTimes(2);
    expect(wsMock.emitBookingUpdate).toHaveBeenCalledWith('booking-1', 'user-1', 'provider-1', 'DECLINED');
  });

  it('rejects unauthorized users from changing booking status', async () => {
    await expect(service.updateStatus('booking-1', 'other-user', 'accepted')).rejects.toBeInstanceOf(ForbiddenException);
    expect(prismaMock.booking.findUniqueOrThrow).toHaveBeenCalledWith({ where: { id: 'booking-1' } });
  });

  it('rejects invalid transition from pending to completed', async () => {
    await expect(service.updateStatus('booking-1', 'provider-1', 'completed')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('does not allow customer to accept a booking', async () => {
    await expect(service.updateStatus('booking-1', 'user-1', 'accepted')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('blocks PATCH COMPLETED even when the booking is in progress', async () => {
    prismaMock.booking.findUniqueOrThrow.mockResolvedValueOnce({ ...mockBooking, status: 'IN_PROGRESS' });

    await expect(service.updateStatus('booking-1', 'provider-1', 'completed'))
      .rejects.toThrow('Bookings can only be completed by scanning the customer completion QR');
    expect(prismaMock.booking.update).not.toHaveBeenCalled();
  });

  it('issues a completion QR to the paying customer of an in-progress booking', async () => {
    prismaMock.booking.findUniqueOrThrow.mockResolvedValueOnce({
      ...mockBooking,
      status: 'IN_PROGRESS',
      payment: { status: 'COMPLETED' },
    });

    const result = await service.issueCompletionQr('booking-1', 'user-1');

    expect(result.token).toEqual(expect.any(String));
    expect(result.payload).toEqual(expect.objectContaining({ bookingId: 'booking-1', nonce: expect.any(String), exp: expect.any(Number) }));
    expect(prismaMock.bookingCompletionToken.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { bookingId: 'booking-1' },
      update: expect.objectContaining({ generatedByUserId: 'user-1', scannedAt: null }),
    }));
  });

  it('rejects completion QR generation from anyone other than the customer', async () => {
    prismaMock.booking.findUniqueOrThrow.mockResolvedValueOnce({
      ...mockBooking,
      status: 'IN_PROGRESS',
      payment: { status: 'COMPLETED' },
    });

    await expect(service.issueCompletionQr('booking-1', 'provider-1'))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  it('completes the booking, releases payout, and notifies both parties on a valid QR scan', async () => {
    prismaMock.booking.findUniqueOrThrow
      .mockResolvedValueOnce({
        ...mockBooking,
        status: 'IN_PROGRESS',
        payment: { status: 'COMPLETED' },
      })
      .mockResolvedValueOnce({
        ...mockBooking,
        status: 'IN_PROGRESS',
        payment: { status: 'COMPLETED' },
      })
      .mockResolvedValueOnce({
        ...mockBooking,
        status: 'PAID',
        payment: { status: 'COMPLETED', payoutReleased: true },
      });

    const issued = await service.issueCompletionQr('booking-1', 'user-1');
    const hashed = prismaMock.bookingCompletionToken.upsert.mock.calls[0][0].create.token;
    prismaMock.bookingCompletionToken.findUnique.mockResolvedValueOnce({
      id: 'token-1',
      bookingId: 'booking-1',
      token: hashed,
      scannedAt: null,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    });

    const result = await service.completeByQr('provider-1', issued.token) as any;

    expect(prismaMock.bookingCompletionToken.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'token-1', scannedAt: null },
    }));
    expect(prismaMock.booking.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'COMPLETED' }),
    }));
    expect(paymentsMock.releasePaymentToProvider).toHaveBeenCalledWith('booking-1', 'user-1');
    expect(notificationsMock.send).toHaveBeenCalledTimes(2);
    expect(result.payout).toEqual(expect.objectContaining({ status: 'RELEASED' }));
  });

  it('rejects a completion QR scan from a provider who is not assigned to the booking', async () => {
    prismaMock.booking.findUniqueOrThrow.mockResolvedValueOnce({
      ...mockBooking,
      status: 'IN_PROGRESS',
      payment: { status: 'COMPLETED' },
    });

    const issued = await service.issueCompletionQr('booking-1', 'user-1');
    const hashed = prismaMock.bookingCompletionToken.upsert.mock.calls[0][0].create.token;
    prismaMock.bookingCompletionToken.findUnique.mockResolvedValueOnce({
      id: 'token-1',
      bookingId: 'booking-1',
      token: hashed,
      scannedAt: null,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    });
    prismaMock.booking.findUniqueOrThrow.mockResolvedValueOnce({
      ...mockBooking,
      status: 'IN_PROGRESS',
      payment: { status: 'COMPLETED' },
    });

    await expect(service.completeByQr('other-provider', issued.token)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prismaMock.booking.update).not.toHaveBeenCalled();
    expect(paymentsMock.releasePaymentToProvider).not.toHaveBeenCalled();
  });

  it('issues a cash completion QR without requiring gateway payment', async () => {
    prismaMock.booking.findUniqueOrThrow.mockResolvedValueOnce({
      ...mockBooking,
      status: 'IN_PROGRESS',
      payment: { status: 'PENDING', paymentMethod: 'CASH' },
    });

    const result = await service.issueCompletionQr('booking-1', 'user-1');
    expect(result.token).toEqual(expect.any(String));
  });

  it('settles cash and completes the job on QR scan without wallet credit', async () => {
    prismaMock.booking.findUniqueOrThrow
      .mockResolvedValueOnce({
        ...mockBooking,
        status: 'IN_PROGRESS',
        payment: { status: 'PENDING', paymentMethod: 'CASH' },
      })
      .mockResolvedValueOnce({
        ...mockBooking,
        status: 'IN_PROGRESS',
        payment: { status: 'PENDING', paymentMethod: 'CASH' },
      })
      .mockResolvedValueOnce({
        ...mockBooking,
        status: 'PAID',
        payment: { status: 'COMPLETED', paymentMethod: 'CASH' },
      });

    const issued = await service.issueCompletionQr('booking-1', 'user-1');
    const hashed = prismaMock.bookingCompletionToken.upsert.mock.calls[0][0].create.token;
    prismaMock.bookingCompletionToken.findUnique.mockResolvedValueOnce({
      id: 'token-1',
      bookingId: 'booking-1',
      token: hashed,
      scannedAt: null,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    });

    const result = await service.completeByQr('provider-1', issued.token) as any;

    expect(prismaMock.payment.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'COMPLETED', paymentMethod: 'CASH' }),
    }));
    expect(paymentsMock.releasePaymentToProvider).not.toHaveBeenCalled();
    expect(result.payout).toEqual(expect.objectContaining({ status: 'CASH_SETTLED' }));
  });
});
