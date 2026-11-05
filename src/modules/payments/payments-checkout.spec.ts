import { BadRequestException } from '@nestjs/common';
import { PaymentsService } from './payments.service';

/**
 * Cart checkout and decline refunds. Kept apart from payments.service.spec.ts
 * so these money paths are exercised with a focused Prisma mock.
 */
function setup() {
  const payments = new Map<string, any>();
  let checkout: any = null;

  const prisma = {
    booking: {
      findMany: jest.fn(),
      findUniqueOrThrow: jest.fn(({ where }) =>
        Promise.resolve({ id: where.id, quotedPrice: where.id === 'b1' ? 1200 : 3500, commissionRate: 0.15 }),
      ),
    },
    user: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'u1', email: 'host@example.com' }) },
    payment: {
      findUnique: jest.fn(({ where, include }) => {
        const p = where.bookingId ? [...payments.values()].find((x) => x.bookingId === where.bookingId) : payments.get(where.id);
        if (!p) return Promise.resolve(null);
        return Promise.resolve(include?.checkout ? { ...p, checkout: checkout && { reference: checkout.reference } } : p);
      }),
      create: jest.fn(({ data }) => {
        const p = { id: `pay-${data.bookingId}`, createdAt: new Date(), ...data };
        payments.set(p.id, p);
        return Promise.resolve(p);
      }),
      update: jest.fn(({ where, data }) => {
        const p = { ...payments.get(where.id), ...data };
        payments.set(where.id, p);
        return Promise.resolve(p);
      }),
      updateMany: jest.fn(({ where, data }) => {
        for (const p of payments.values()) if (p.checkoutId === where.checkoutId) Object.assign(p, data);
        return Promise.resolve({ count: payments.size });
      }),
    },
    paymentCheckout: {
      create: jest.fn(({ data }) => Promise.resolve((checkout = { id: 'co1', status: 'PENDING', ...data }))),
      update: jest.fn(({ data }) => Promise.resolve((checkout = { ...checkout, ...data }))),
      findUnique: jest.fn(() =>
        Promise.resolve(checkout && { ...checkout, payments: [...payments.values()].filter((p) => p.checkoutId === checkout.id) }),
      ),
    },
    adminSettings: { findUnique: jest.fn().mockResolvedValue(null) },
  };

  const config = {
    get: jest.fn((key: string, fallback?: unknown) =>
      ({
        'payment.paystackSecretKey': 'sk_test_x',
        'payment.paystackReturnUrl': 'https://api.example.com/payments/paystack/return',
      })[key] ?? fallback,
    ),
  };
  const notifications = { send: jest.fn().mockResolvedValue(undefined) };
  const service = new PaymentsService(prisma as any, config as any, {} as any, notifications as any, {} as any);
  const markCompleted = jest
    .spyOn(service as any, 'markPaymentCompleted')
    .mockImplementation(async (p: any, txId: any) => {
      payments.set(p.id, { ...payments.get(p.id), status: 'COMPLETED', gatewayTransactionId: txId });
    });

  return { prisma, service, payments, getCheckout: () => checkout, markCompleted, notifications };
}

const fetchMock = jest.fn();
beforeAll(() => {
  (global as any).fetch = fetchMock;
});
beforeEach(() => fetchMock.mockReset());

function paystackReplies(...bodies: any[]) {
  for (const body of bodies) fetchMock.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(body) });
}

describe('Cart checkout', () => {
  it('charges the cart total once and gives every booking its own payment', async () => {
    const { prisma, service, payments } = setup();
    prisma.booking.findMany.mockResolvedValue([
      { id: 'b1', userId: 'u1', providerId: 'dj', status: 'AWAITING_PAYMENT' },
      { id: 'b2', userId: 'u1', providerId: 'mc', status: 'AWAITING_PAYMENT' },
    ]);
    paystackReplies({ status: true, data: { authorization_url: 'https://checkout.paystack.com/x', access_code: 'ac' } });

    const result = await service.initiatePaystackCheckout('u1', ['b1', 'b2', 'b1']);

    const init = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(init.amount).toBe(470000); // R1,200 + R3,500 in cents
    expect(init.reference).toMatch(/^cart_co1_/);
    expect(result).toMatchObject({ checkoutUrl: 'https://checkout.paystack.com/x', total: 4700, bookingIds: ['b1', 'b2'] });
    const rows = [...payments.values()];
    expect(rows.map((p) => [p.providerId, Number(p.amount), p.checkoutId])).toEqual([
      ['dj', 1200, 'co1'],
      ['mc', 3500, 'co1'],
    ]);
    expect(rows.every((p) => p.gatewayPaymentToken === init.reference)).toBe(true);
  });

  it("refuses bookings that aren't the host's or aren't awaiting payment", async () => {
    const { prisma, service } = setup();
    prisma.booking.findMany.mockResolvedValue([{ id: 'b1', userId: 'someone-else', status: 'AWAITING_PAYMENT' }]);
    await expect(service.initiatePaystackCheckout('u1', ['b1'])).rejects.toBeInstanceOf(BadRequestException);

    prisma.booking.findMany.mockResolvedValue([{ id: 'b1', userId: 'u1', status: 'PENDING' }]);
    await expect(service.initiatePaystackCheckout('u1', ['b1'])).rejects.toBeInstanceOf(BadRequestException);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('settles every booking in the cart once Paystack confirms the full amount', async () => {
    const { prisma, service, payments, getCheckout, markCompleted } = setup();
    prisma.booking.findMany.mockResolvedValue([
      { id: 'b1', userId: 'u1', providerId: 'dj', status: 'AWAITING_PAYMENT' },
      { id: 'b2', userId: 'u1', providerId: 'mc', status: 'AWAITING_PAYMENT' },
    ]);
    paystackReplies({ status: true, data: { authorization_url: 'https://x', access_code: 'ac' } });
    await service.initiatePaystackCheckout('u1', ['b1', 'b2']);
    const reference = getCheckout().reference;

    paystackReplies({ status: true, data: { status: 'success', amount: 470000, reference } });
    const firstBooking = await service.handlePaystackReturn(reference);

    expect(firstBooking).toBe('b1');
    expect(markCompleted).toHaveBeenCalledTimes(2);
    expect([...payments.values()].map((p) => p.gatewayTransactionId)).toEqual([
      `${reference}:pay-b1`,
      `${reference}:pay-b2`,
    ]);
    expect(getCheckout().status).toBe('PAID');
  });

  it('does not settle a cart that was underpaid', async () => {
    const { prisma, service, getCheckout, markCompleted } = setup();
    prisma.booking.findMany.mockResolvedValue([
      { id: 'b1', userId: 'u1', providerId: 'dj', status: 'AWAITING_PAYMENT' },
      { id: 'b2', userId: 'u1', providerId: 'mc', status: 'AWAITING_PAYMENT' },
    ]);
    paystackReplies({ status: true, data: { authorization_url: 'https://x', access_code: 'ac' } });
    await service.initiatePaystackCheckout('u1', ['b1', 'b2']);
    const reference = getCheckout().reference;

    paystackReplies({ status: true, data: { status: 'success', amount: 120000, reference } });
    await expect(service.handlePaystackReturn(reference)).rejects.toBeInstanceOf(BadRequestException);
    expect(markCompleted).not.toHaveBeenCalled();
  });
});

describe('Refund on decline', () => {
  it("refunds only the declining talent's share of a paid cart", async () => {
    const { service, payments, getCheckout, prisma } = setup();
    prisma.booking.findMany.mockResolvedValue([
      { id: 'b1', userId: 'u1', providerId: 'dj', status: 'AWAITING_PAYMENT' },
      { id: 'b2', userId: 'u1', providerId: 'mc', status: 'AWAITING_PAYMENT' },
    ]);
    paystackReplies({ status: true, data: { authorization_url: 'https://x', access_code: 'ac' } });
    await service.initiatePaystackCheckout('u1', ['b1', 'b2']);
    for (const p of payments.values()) p.status = 'COMPLETED';

    paystackReplies({ status: true, data: { status: 'pending' } });
    const result = await service.refundDeclinedBooking('b2', 'Double booked');

    expect(result).toEqual({ refunded: true });
    const body = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(body).toMatchObject({ transaction: getCheckout().reference, amount: 350000 });
    expect(payments.get('pay-b2')).toMatchObject({ status: 'REFUNDED', refundReason: 'Double booked' });
    expect(payments.get('pay-b1').status).toBe('COMPLETED');
  });

  it('leaves unpaid bookings alone and reports a failed refund without throwing', async () => {
    const { service, payments, notifications } = setup();
    payments.set('pay-b9', { id: 'pay-b9', bookingId: 'b9', userId: 'u1', status: 'PENDING', amount: 900 });
    expect(await service.refundDeclinedBooking('b9')).toEqual({ refunded: false });
    expect(fetchMock).not.toHaveBeenCalled();

    payments.set('pay-b8', {
      id: 'pay-b8',
      bookingId: 'b8',
      userId: 'u1',
      status: 'COMPLETED',
      amount: 900,
      gatewayPaymentToken: 'pay_x_1',
    });
    fetchMock.mockResolvedValueOnce({ ok: false, status: 400, json: () => Promise.resolve({ status: false, message: 'Nope' }) });
    expect(await service.refundDeclinedBooking('b8')).toEqual({ refunded: false });
    expect(payments.get('pay-b8').status).toBe('COMPLETED');
    expect(notifications.send).toHaveBeenCalledWith('u1', 'PAYMENT_FAILED', 'Refund needs attention', expect.any(String), expect.anything(), 'user');
  });
});
