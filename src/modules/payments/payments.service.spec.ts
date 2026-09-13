/// <reference types="jest" />
import { Test, TestingModule } from '@nestjs/testing';
import { PaymentsService } from './payments.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { WalletService } from '../wallet/wallet.service';

describe('PaymentsService', () => {
  let service: PaymentsService;
  const prismaMock = {
    booking: {
      findUniqueOrThrow: jest.fn(),
      update: jest.fn(),
    },
    user: {
      findUniqueOrThrow: jest.fn(),
    },
    payment: {
      findUnique: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
    },
    adminSettings: {
      findUnique: jest.fn().mockResolvedValue({ defaultCommissionRate: 0.15 }),
    },
  };
  const configMock = {
    get: jest.fn().mockReturnValue(undefined),
  };
  const walletMock = {
    credit: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: ConfigService, useValue: configMock },
        { provide: WalletService, useValue: walletMock },
      ],
    }).compile();

    service = module.get<PaymentsService>(PaymentsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  function attachStripeMock(overrides?: {
    create?: jest.Mock;
    retrieve?: jest.Mock;
  }) {
    const create = overrides?.create ?? jest.fn();
    const retrieve = overrides?.retrieve ?? jest.fn();
    (service as any).stripe = {
      checkout: {
        sessions: { create, retrieve },
      },
    };
    return { create, retrieve };
  }

  it('updates payment and booking to PAID when PayFast ITN reports COMPLETE', async () => {
    prismaMock.payment.findUnique.mockResolvedValue({
      id: 'payment-1',
      bookingId: 'booking-1',
      providerId: 'provider-1',
      amount: 200,
      commissionAmount: 30,
      commissionRate: 0.15,
      providerEarnings: 170,
    });

    await service.handlePayfastItn({
      m_payment_id: 'payment-1',
      payment_status: 'COMPLETE',
      pf_payment_id: 'txn-123',
    });

    expect(prismaMock.payment.update).toHaveBeenCalledWith({
      where: { id: 'payment-1' },
      data: expect.objectContaining({
        status: 'COMPLETED',
        gatewayTransactionId: 'txn-123',
        gatewayResponse: expect.any(Object),
      }),
    });
    expect(prismaMock.booking.update).toHaveBeenCalledWith({
      where: { id: 'booking-1' },
      data: expect.objectContaining({
        status: 'PAID',
        paidAt: expect.any(Date),
      }),
    });
    // Wallet should NOT be credited automatically; release should be triggered by customer confirmation
    expect(walletMock.credit).not.toHaveBeenCalled();
  });

  it('marks payment as FAILED and does not update booking when PayFast ITN reports FAILED', async () => {
    prismaMock.payment.findUnique.mockResolvedValue({
      id: 'payment-2',
      bookingId: 'booking-2',
      providerId: 'provider-2',
      amount: 150,
      commissionAmount: 22.5,
      commissionRate: 0.15,
      providerEarnings: 127.5,
    });

    await service.handlePayfastItn({
      m_payment_id: 'payment-2',
      payment_status: 'FAILED',
      pf_payment_id: 'txn-456',
    });

    expect(prismaMock.payment.update).toHaveBeenCalledWith({
      where: { id: 'payment-2' },
      data: expect.objectContaining({
        status: 'FAILED',
        gatewayTransactionId: 'txn-456',
        failedAt: expect.any(Date),
        failureReason: 'FAILED',
      }),
    });
    expect(prismaMock.booking.update).not.toHaveBeenCalled();
    expect(walletMock.credit).not.toHaveBeenCalled();
  });

  it('reuses an existing pending payment when initiating PayFast for a booking twice', async () => {
    prismaMock.booking.findUniqueOrThrow.mockResolvedValue({
      id: 'booking-1',
      providerId: 'provider-1',
      quotedPrice: 250,
      commissionRate: 0.15,
      request: { title: 'Test Service' },
    });
    prismaMock.payment.findUnique.mockResolvedValue({
      id: 'payment-1',
      bookingId: 'booking-1',
      status: 'PENDING',
      providerId: 'provider-1',
      amount: 250,
      commissionAmount: 37.5,
      commissionRate: 0.15,
      providerEarnings: 212.5,
    });
    configMock.get.mockImplementation((key: string) => {
      switch (key) {
        case 'payment.payfastMerchantId':
        case 'payment.payfastMerchantKey':
        case 'payment.payfastPassphrase':
        case 'payment.payfastReturnUrl':
        case 'payment.payfastCancelUrl':
        case 'payment.payfastNotifyUrl':
          return 'test';
        case 'payment.payfastSandbox':
          return true;
        case 'payment.payfastPaymentMethod':
          return 'cc';
        default:
          return 0.15;
      }
    });

    const result = await service.initiatePayfast('booking-1', 'user-1');

    expect(prismaMock.payment.create).not.toHaveBeenCalled();
    expect(result.paymentId).toBe('payment-1');
    expect(result.payfastUrl).toContain('sandbox.payfast.co.za');
    expect(result.pfData.payment_method).toBe('cc');
  });

  it('creates a Stripe checkout session for a pending booking payment', async () => {
    prismaMock.booking.findUniqueOrThrow.mockResolvedValue({
      id: 'booking-3',
      providerId: 'provider-3',
      quotedPrice: 250,
      commissionRate: 0.15,
    });
    prismaMock.payment.findUnique.mockResolvedValue({
      id: 'payment-3',
      bookingId: 'booking-3',
      status: 'PENDING',
      providerId: 'provider-3',
      amount: 250,
      commissionAmount: 37.5,
      commissionRate: 0.15,
      providerEarnings: 212.5,
    });
    prismaMock.payment.update.mockResolvedValueOnce({
      id: 'payment-3',
      bookingId: 'booking-3',
      providerId: 'provider-3',
      amount: 250,
      commissionAmount: 37.5,
      commissionRate: 0.15,
      providerEarnings: 212.5,
      status: 'PENDING',
      paymentGateway: 'STRIPE',
    }).mockResolvedValueOnce({ id: 'payment-3' });
    configMock.get.mockImplementation((key: string) => {
      switch (key) {
        case 'payment.stripeReturnUrl':
          return 'http://localhost:4000/api/v1/payments/stripe/return';
        case 'payment.stripeCancelUrl':
          return 'http://localhost:4000/api/v1/payments/stripe/cancel';
        default:
          return 0.15;
      }
    });
    const stripe = attachStripeMock({
      create: jest.fn().mockResolvedValue({
        id: 'cs_test_123',
        url: 'https://checkout.stripe.com/pay/cs_test_123',
      }),
    });

    const result = await service.initiateStripe('booking-3', 'user-3');

    expect(stripe.create).toHaveBeenCalledWith(expect.objectContaining({
      mode: 'payment',
      metadata: expect.objectContaining({ paymentId: 'payment-3', bookingId: 'booking-3', userId: 'user-3' }),
    }));
    expect(result).toEqual(expect.objectContaining({
      paymentId: 'payment-3',
      checkoutSessionId: 'cs_test_123',
      checkoutUrl: 'https://checkout.stripe.com/pay/cs_test_123',
    }));
  });

  it('marks a Stripe payment complete when the hosted checkout return session is paid', async () => {
    prismaMock.payment.findUnique
      .mockResolvedValueOnce({
        id: 'payment-4',
        bookingId: 'booking-4',
        providerId: 'provider-4',
        amount: 300,
        commissionAmount: 45,
        commissionRate: 0.15,
        providerEarnings: 255,
        status: 'PENDING',
      });
    const stripe = attachStripeMock({
      retrieve: jest.fn().mockResolvedValue({
        id: 'cs_test_paid',
        payment_status: 'paid',
        payment_intent: 'pi_123',
        metadata: { paymentId: 'payment-4' },
      }),
    });

    const bookingId = await service.handleStripeReturn('cs_test_paid');

    expect(stripe.retrieve).toHaveBeenCalledWith('cs_test_paid');
    expect(bookingId).toBe('booking-4');
    expect(prismaMock.payment.update).toHaveBeenCalledWith({
      where: { id: 'payment-4' },
      data: expect.objectContaining({
        status: 'COMPLETED',
        gatewayTransactionId: 'pi_123',
      }),
    });
    expect(prismaMock.booking.update).toHaveBeenCalledWith({
      where: { id: 'booking-4' },
      data: expect.objectContaining({ status: 'PAID' }),
    });
  });

  it('verifies Stripe webhook signature and marks payment complete from checkout.session.completed', async () => {
    const rawBody = Buffer.from('{"id":"evt_1"}');
    configMock.get.mockImplementation((key: string) => {
      if (key === 'payment.stripeWebhookSecret') return 'whsec_test';
      return 0.15;
    });
    prismaMock.payment.findUnique.mockResolvedValueOnce({
      id: 'payment-5',
      bookingId: 'booking-5',
      providerId: 'provider-5',
      amount: 300,
      commissionAmount: 45,
      commissionRate: 0.15,
      providerEarnings: 255,
      status: 'PENDING',
    });

    const stripe = attachStripeMock();
    (service as any).stripe = {
      ...((service as any).stripe ?? {}),
      checkout: stripe ? (service as any).stripe.checkout : undefined,
      webhooks: {
        constructEvent: jest.fn().mockReturnValue({
          id: 'evt_1',
          type: 'checkout.session.completed',
          data: {
            object: {
              id: 'cs_test_webhook',
              payment_intent: 'pi_webhook',
              metadata: { paymentId: 'payment-5' },
            },
          },
        }),
      },
    };

    const result = await service.handleStripeWebhook(rawBody, 't=123,v1=sig');

    expect((service as any).stripe.webhooks.constructEvent).toHaveBeenCalledWith(rawBody, 't=123,v1=sig', 'whsec_test');
    expect(result).toEqual({ received: true });
    expect(prismaMock.payment.update).toHaveBeenCalledWith({
      where: { id: 'payment-5' },
      data: expect.objectContaining({
        status: 'COMPLETED',
        gatewayTransactionId: 'pi_webhook',
      }),
    });
  });

  it('initializes a Paystack hosted checkout for pay-now online payments', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: true,
        data: {
          authorization_url: 'https://checkout.paystack.com/abc123',
          access_code: 'abc123',
        },
      }),
    });
    (global as any).fetch = fetchMock;

    prismaMock.booking.findUniqueOrThrow.mockResolvedValue({
      id: 'booking-6',
      providerId: 'provider-6',
      quotedPrice: 250,
      commissionRate: 0.15,
    });
    prismaMock.user.findUniqueOrThrow.mockResolvedValue({ id: 'user-6', email: 'user6@test.com' });
    prismaMock.payment.findUnique.mockResolvedValue({
      id: 'payment-6',
      bookingId: 'booking-6',
      status: 'PENDING',
      providerId: 'provider-6',
      amount: 250,
      commissionAmount: 37.5,
      commissionRate: 0.15,
      providerEarnings: 212.5,
    });
    prismaMock.payment.update.mockResolvedValue({ id: 'payment-6' });

    configMock.get.mockImplementation((key: string) => {
      switch (key) {
        case 'payment.paystackSecretKey':
          return 'sk_test_paystack';
        case 'payment.paystackReturnUrl':
          return 'http://localhost:4000/api/v1/payments/paystack/return';
        default:
          return 0.15;
      }
    });

    const result = await service.initiatePaystack('booking-6', 'user-6');

    expect(fetchMock).toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      paymentId: 'payment-6',
      checkoutUrl: 'https://checkout.paystack.com/abc123',
    }));
  });

  it('verifies a Paystack return reference and marks payment as paid', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: true,
        data: {
          status: 'success',
          metadata: { paymentId: 'payment-7' },
        },
      }),
    });
    (global as any).fetch = fetchMock;

    configMock.get.mockImplementation((key: string) => {
      if (key === 'payment.paystackSecretKey') return 'sk_test_paystack';
      return 0.15;
    });
    prismaMock.payment.findUnique.mockResolvedValueOnce({
      id: 'payment-7',
      bookingId: 'booking-7',
      providerId: 'provider-7',
      amount: 300,
      commissionAmount: 45,
      commissionRate: 0.15,
      providerEarnings: 255,
      status: 'PENDING',
    });

    const bookingId = await service.handlePaystackReturn('pay_ref_123');

    expect(bookingId).toBe('booking-7');
    expect(prismaMock.payment.update).toHaveBeenCalledWith({
      where: { id: 'payment-7' },
      data: expect.objectContaining({ status: 'COMPLETED' }),
    });
  });

  it('releases payout to provider when customer confirms and booking is completed', async () => {
    prismaMock.payment.findUnique.mockResolvedValueOnce({
      id: 'payment-8',
      bookingId: 'booking-8',
      providerId: 'provider-8',
      amount: 400,
      commissionAmount: 60,
      commissionRate: 0.15,
      providerEarnings: 340,
      userId: 'user-8',
      status: 'COMPLETED',
    });
    // booking exists and is COMPLETED
    prismaMock.booking.findUnique = jest.fn().mockResolvedValue({ id: 'booking-8', status: 'COMPLETED' });
    // walletTransaction.findUnique used in release check
    prismaMock.walletTransaction = { findUnique: jest.fn().mockResolvedValue(null) };

    const result = await service.releasePaymentToProvider('booking-8', 'user-8');
    expect(walletMock.credit).toHaveBeenCalledWith('provider-8', 340, 'payment-8', expect.stringContaining('booking booking-8'));
    expect(prismaMock.payment.update).toHaveBeenCalledWith({ where: { id: 'payment-8' }, data: expect.objectContaining({ payoutReleased: true, payoutReleasedBy: 'user-8' }) });
    expect(result).toEqual(expect.objectContaining({ status: 'RELEASED' }));
  });
});
