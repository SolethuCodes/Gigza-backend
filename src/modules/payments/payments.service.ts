import { Injectable, NotFoundException, BadRequestException, Logger, Inject, forwardRef } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { WalletService } from '../wallet/wallet.service';
import { NotificationsService } from '../notifications/notifications.service';
import { BookingsService } from '../bookings/bookings.service';
import Stripe from 'stripe';
import * as crypto from 'crypto';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);
  private stripe: Stripe | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly wallet: WalletService,
    private readonly notifications: NotificationsService,
    @Inject(forwardRef(() => BookingsService))
    private readonly bookings: BookingsService,
  ) {
    const stripeKey = config.get<string>('payment.stripeSecretKey');
    if (stripeKey) this.stripe = new Stripe(stripeKey);
  }

  async getBreakdown(bookingId: string) {
    const booking = await this.prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
    const bookingRate = Number(booking.commissionRate);
    const commissionRate = Number.isFinite(bookingRate) && bookingRate >= 0
      ? bookingRate
      : await this.resolveCommissionRate();
    const amount = Number(booking.quotedPrice);
    const commissionAmount = Math.round(amount * commissionRate * 100) / 100;
    return {
      amount,
      basePrice: amount,
      serviceFee: 0,
      platformFee: commissionAmount,
      totalAmount: amount,
      commissionRate,
      commissionAmount,
      providerEarnings: Math.round((amount - commissionAmount) * 100) / 100,
      currency: 'ZAR',
    };
  }

  private async resolveCommissionRate() {
    const fallbackRateRaw = Number(this.config.get<number>('payment.commissionRate', 0.15));
    const fallbackRate = Number.isFinite(fallbackRateRaw) && fallbackRateRaw >= 0 ? fallbackRateRaw : 0.15;

    const settings = await this.prisma.adminSettings.findUnique({
      where: { id: 'singleton' },
      select: { defaultCommissionRate: true },
    });

    const adminRate = Number(settings?.defaultCommissionRate);
    return Number.isFinite(adminRate) && adminRate >= 0 ? adminRate : fallbackRate;
  }

  private assertOnlineCheckoutAllowed(
    payment: { paymentMethod: string; status: string; paymentGateway: string } | null,
    gateway: 'PAYFAST' | 'STRIPE' | 'PAYSTACK',
  ) {
    if (!payment) return;
    if (payment.paymentMethod === 'CASH') {
      throw new BadRequestException('This booking is set to cash. Online checkout is not available.');
    }
    if (payment.status === 'COMPLETED') {
      throw new BadRequestException('Payment already processed for this booking');
    }
    if (payment.status === 'PROCESSING' && payment.paymentGateway !== gateway) {
      throw new BadRequestException('A payment is already in progress for this booking.');
    }
  }

  async initiatePayfast(bookingId: string, userId: string) {
    this.logger.log(`initiatePayfast bookingId=${bookingId} userId=${userId}`);
    const breakdown = await this.getBreakdown(bookingId);
    const booking = await this.prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });

    const existingPayment = await this.prisma.payment.findUnique({ where: { bookingId } });
    this.assertOnlineCheckoutAllowed(existingPayment, 'PAYFAST');
    if (existingPayment) {
      if (existingPayment.status !== 'PENDING' && existingPayment.status !== 'PROCESSING') {
        this.logger.warn(`Existing payment already processed paymentId=${existingPayment.id} status=${existingPayment.status}`);
        throw new BadRequestException('Payment already processed for this booking');
      }
    }

    const payment = existingPayment ?? await this.prisma.payment.create({
      data: {
        bookingId,
        userId,
        providerId: booking.providerId,
        amount: breakdown.amount,
        commissionAmount: breakdown.commissionAmount,
        commissionRate: breakdown.commissionRate,
        providerEarnings: breakdown.providerEarnings,
        paymentMethod: 'CARD',
        paymentGateway: 'PAYFAST',
        status: 'PENDING',
      },
    });

    this.logger.log(`initiatePayfast paymentId=${payment.id} amount=${payment.amount} bookingId=${bookingId}`);
    const checkoutData = this.buildPayfastCheckoutData(payment, booking);
    return { paymentId: payment.id, ...checkoutData, breakdown };
  }

  async initiateStripe(bookingId: string, userId: string) {
    this.logger.log(`initiateStripe bookingId=${bookingId} userId=${userId}`);

    if (!this.stripe) {
      throw new BadRequestException('Stripe is not configured');
    }

    const breakdown = await this.getBreakdown(bookingId);
    const booking = await this.prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });

    const existingPayment = await this.prisma.payment.findUnique({ where: { bookingId } });
    this.assertOnlineCheckoutAllowed(existingPayment, 'STRIPE');
    if (existingPayment && existingPayment.status !== 'PENDING' && existingPayment.status !== 'PROCESSING') {
      this.logger.warn(`Existing payment already processed paymentId=${existingPayment.id} status=${existingPayment.status}`);
      throw new BadRequestException('Payment already processed for this booking');
    }

    const payment = existingPayment
      ? await this.prisma.payment.update({
          where: { id: existingPayment.id },
          data: {
            amount: breakdown.amount,
            commissionAmount: breakdown.commissionAmount,
            commissionRate: breakdown.commissionRate,
            providerEarnings: breakdown.providerEarnings,
            paymentMethod: 'CARD',
            paymentGateway: 'STRIPE',
            status: 'PENDING',
            failedAt: null,
            failureReason: null,
          },
        })
      : await this.prisma.payment.create({
          data: {
            bookingId,
            userId,
            providerId: booking.providerId,
            amount: breakdown.amount,
            commissionAmount: breakdown.commissionAmount,
            commissionRate: breakdown.commissionRate,
            providerEarnings: breakdown.providerEarnings,
            paymentMethod: 'CARD',
            paymentGateway: 'STRIPE',
            status: 'PENDING',
          },
        });

    const returnUrl = this.config.get<string>('payment.stripeReturnUrl');
    const cancelUrl = this.config.get<string>('payment.stripeCancelUrl');
    if (!returnUrl || !cancelUrl) {
      throw new BadRequestException('Stripe return URLs are not configured');
    }

    const session = await this.stripe.checkout.sessions.create({
      mode: 'payment',
      success_url: `${returnUrl}?bookingId=${encodeURIComponent(booking.id)}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${cancelUrl}?bookingId=${encodeURIComponent(booking.id)}`,
      payment_method_types: ['card'],
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: String(breakdown.currency ?? 'ZAR').toLowerCase(),
            unit_amount: Math.round(Number(breakdown.totalAmount) * 100),
            product_data: {
              name: `E-RRANDS booking ${booking.id}`,
            },
          },
        },
      ],
      metadata: {
        bookingId: booking.id,
        paymentId: payment.id,
        userId,
      },
    });

    await this.prisma.payment.update({
      where: { id: payment.id },
      data: {
        gatewayPaymentToken: session.id,
        gatewayResponse: { checkoutSessionId: session.id, checkoutUrl: session.url },
      },
    });

    return {
      paymentId: payment.id,
      checkoutSessionId: session.id,
      checkoutUrl: session.url,
      breakdown,
    };
  }

  /**
   * Create a Stripe PaymentIntent for native in-app confirmation (Apple Pay /
   * Google Pay / card via @stripe/stripe-react-native). The client confirms the
   * returned client_secret; `payment_intent.succeeded` webhook settles it.
   */
  async createStripePaymentIntent(bookingId: string, userId: string) {
    this.logger.log(`createStripePaymentIntent bookingId=${bookingId} userId=${userId}`);

    if (!this.stripe) {
      throw new BadRequestException('Stripe is not configured');
    }

    const publishableKey = this.config.get<string>('payment.stripePublishableKey');
    if (!publishableKey) {
      throw new BadRequestException('Stripe publishable key is not configured');
    }

    const breakdown = await this.getBreakdown(bookingId);
    const booking = await this.prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
    if (booking.userId !== userId) {
      throw new BadRequestException('You do not have permission to pay for this booking');
    }

    const existingPayment = await this.prisma.payment.findUnique({ where: { bookingId } });
    this.assertOnlineCheckoutAllowed(existingPayment, 'STRIPE');
    if (existingPayment && existingPayment.status === 'COMPLETED') {
      throw new BadRequestException('Payment already processed for this booking');
    }

    const paymentData = {
      amount: breakdown.amount,
      commissionAmount: breakdown.commissionAmount,
      commissionRate: breakdown.commissionRate,
      providerEarnings: breakdown.providerEarnings,
      paymentMethod: 'MOBILE_WALLET' as const,
      paymentGateway: 'STRIPE' as const,
      status: 'PENDING' as const,
      failedAt: null,
      failureReason: null,
    };
    const payment = existingPayment
      ? await this.prisma.payment.update({ where: { id: existingPayment.id }, data: paymentData })
      : await this.prisma.payment.create({
          data: { bookingId, userId, providerId: booking.providerId, ...paymentData },
        });

    const currency = String(breakdown.currency ?? 'ZAR').toLowerCase();
    const amountMinor = Math.round(Number(breakdown.totalAmount) * 100);

    // Reuse the PaymentIntent if one is already attached and still confirmable.
    let intent: Stripe.PaymentIntent | null = null;
    const existingIntentId = (payment.gatewayResponse as { paymentIntentId?: string } | null)?.paymentIntentId;
    if (existingIntentId) {
      const found = await this.stripe.paymentIntents.retrieve(existingIntentId).catch(() => null);
      if (found && ['requires_payment_method', 'requires_confirmation', 'requires_action'].includes(found.status)) {
        intent =
          found.amount === amountMinor
            ? found
            : await this.stripe.paymentIntents.update(found.id, { amount: amountMinor });
      }
    }
    if (!intent) {
      intent = await this.stripe.paymentIntents.create({
        amount: amountMinor,
        currency,
        automatic_payment_methods: { enabled: true },
        description: `Errandss booking ${booking.id}`,
        metadata: { bookingId: booking.id, paymentId: payment.id, userId },
      });
    }

    await this.prisma.payment.update({
      where: { id: payment.id },
      data: {
        gatewayPaymentToken: intent.id,
        gatewayResponse: { paymentIntentId: intent.id, clientSecret: intent.client_secret },
      },
    });

    return {
      paymentId: payment.id,
      clientSecret: intent.client_secret,
      publishableKey,
      amount: Number(breakdown.totalAmount),
      amountMinor,
      currency: currency.toUpperCase(),
    };
  }

  async initiatePaystack(bookingId: string, userId: string) {
    this.logger.log(`initiatePaystack bookingId=${bookingId} userId=${userId}`);

    const paystackSecretKey = this.config.get<string>('payment.paystackSecretKey');
    if (!paystackSecretKey) {
      throw new BadRequestException('Paystack is not configured');
    }

    const breakdown = await this.getBreakdown(bookingId);
    const booking = await this.prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });

    const existingPayment = await this.prisma.payment.findUnique({ where: { bookingId } });
    this.assertOnlineCheckoutAllowed(existingPayment, 'PAYSTACK');
    if (existingPayment && existingPayment.status !== 'PENDING' && existingPayment.status !== 'PROCESSING') {
      this.logger.warn(`Existing payment already processed paymentId=${existingPayment.id} status=${existingPayment.status}`);
      throw new BadRequestException('Payment already processed for this booking');
    }

    const payment = existingPayment
      ? await this.prisma.payment.update({
          where: { id: existingPayment.id },
          data: {
            amount: breakdown.amount,
            commissionAmount: breakdown.commissionAmount,
            commissionRate: breakdown.commissionRate,
            providerEarnings: breakdown.providerEarnings,
            paymentMethod: 'CARD',
            paymentGateway: 'MANUAL',
            status: 'PENDING',
            failedAt: null,
            failureReason: null,
          },
        })
      : await this.prisma.payment.create({
          data: {
            bookingId,
            userId,
            providerId: booking.providerId,
            amount: breakdown.amount,
            commissionAmount: breakdown.commissionAmount,
            commissionRate: breakdown.commissionRate,
            providerEarnings: breakdown.providerEarnings,
            paymentMethod: 'CARD',
            paymentGateway: 'MANUAL',
            status: 'PENDING',
          },
        });

    const returnUrl = this.config.get<string>('payment.paystackReturnUrl');
    if (!returnUrl) {
      throw new BadRequestException('Paystack return URL is not configured');
    }

    const reference = `pay_${payment.id}_${Date.now()}`;
    const payload = {
      email: user.email,
      amount: Math.round(Number(breakdown.totalAmount) * 100),
      reference,
      callback_url: `${returnUrl}?bookingId=${encodeURIComponent(booking.id)}`,
      metadata: {
        paymentId: payment.id,
        bookingId: booking.id,
        userId,
      },
      channels: ['card', 'bank', 'ussd', 'mobile_money', 'bank_transfer'],
    };

    const response = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${paystackSecretKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json() as any;
    if (!response.ok || !data?.status || !data?.data?.authorization_url) {
      this.logger.error(`Paystack initialize failed status=${response.status} message=${data?.message ?? 'unknown'}`);
      throw new BadRequestException(data?.message ?? 'Failed to initialize Paystack payment');
    }

    await this.prisma.payment.update({
      where: { id: payment.id },
      data: {
        gatewayPaymentToken: reference,
        gatewayResponse: {
          provider: 'paystack',
          reference,
          authorizationUrl: data.data.authorization_url,
          accessCode: data.data.access_code,
        },
      },
    });

    return {
      paymentId: payment.id,
      checkoutUrl: data.data.authorization_url,
      reference,
      breakdown,
    };
  }

  async getPayfastCheckoutHtml(paymentId: string): Promise<string> {
    this.logger.log(`getPayfastCheckoutHtml paymentId=${paymentId}`);
    const payment = await this.prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    const booking = await this.prisma.booking.findUniqueOrThrow({ where: { id: payment.bookingId } });
    const { payfastUrl, pfData } = this.buildPayfastCheckoutData(payment, booking);
    this.logger.log(`PayFast form action=${payfastUrl} m_payment_id=${pfData.m_payment_id} bookingId=${booking.id}`);

    const fields = Object.entries(pfData)
      .map(
        ([key, value]) =>
          `<input type="hidden" name="${encodeURIComponent(key)}" value="${encodeURIComponent(value)}" />`,
      )
      .join('');

    return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>PayFast Checkout</title>
  </head>
  <body>
    <p style="font-family:sans-serif;text-align:center;padding-top:40px;">Redirecting to PayFast…</p>
    <form id="payfastForm" action="${payfastUrl}" method="post">
      ${fields}
    </form>
    <script>document.getElementById('payfastForm').submit();</script>
  </body>
</html>`;
  }

  private buildPayfastCheckoutData(payment: any, booking: any) {
    const merchantId = this.config.get('payment.payfastMerchantId', '');
    const merchantKey = this.config.get('payment.payfastMerchantKey', '');
    const passphrase = this.config.get('payment.payfastPassphrase', '');
    const isSandbox = this.config.get('payment.payfastSandbox', true);

    const paymentMethod = this.config.get('payment.payfastPaymentMethod', 'cc');
    const pfData: Record<string, string> = {
      merchant_id: merchantId,
      merchant_key: merchantKey,
      return_url: `${this.config.get('payment.payfastReturnUrl')}?bookingId=${booking.id}`,
      cancel_url: `${this.config.get('payment.payfastCancelUrl')}?bookingId=${booking.id}`,
      notify_url: `${this.config.get('payment.payfastNotifyUrl')}`,
      m_payment_id: payment.id,
      amount: Number(payment.amount).toFixed(2),
      item_name: `E-RRANDS: booking ${booking.id}`,
      custom_str1: booking.id,
      custom_str2: payment.userId,
      payment_method: paymentMethod,
    };

    const pfParamString = Object.entries(pfData)
      .map(([k, v]) => `${k}=${encodeURIComponent(String(v)).replace(/%20/g, '+')}`)
      .join('&');
    const signatureString = passphrase ? `${pfParamString}&passphrase=${encodeURIComponent(passphrase)}` : pfParamString;
    pfData.signature = crypto.createHash('md5').update(signatureString).digest('hex');

    const baseUrl = isSandbox ? 'https://sandbox.payfast.co.za/eng/process' : 'https://www.payfast.co.za/eng/process';
    return { payfastUrl: baseUrl, pfData };
  }

  async handleStripeReturn(sessionId: string) {
    if (!this.stripe) {
      throw new BadRequestException('Stripe is not configured');
    }

    if (!sessionId) {
      throw new BadRequestException('Missing Stripe session ID');
    }

    const session = await this.stripe.checkout.sessions.retrieve(sessionId);
    const paymentId = session.metadata?.paymentId;
    if (!paymentId) {
      throw new NotFoundException('Stripe session is missing payment metadata');
    }

    const payment = await this.prisma.payment.findUnique({ where: { id: paymentId } });
    if (!payment) {
      throw new NotFoundException('Payment not found');
    }

    if (payment.status === 'COMPLETED') {
      return payment.bookingId;
    }

    if (session.payment_status === 'paid') {
      const gatewayTransactionId = typeof session.payment_intent === 'string'
        ? session.payment_intent
        : session.id;
      await this.markPaymentCompleted(payment, gatewayTransactionId, session);
      return payment.bookingId;
    }

    this.logger.warn(`Stripe session not paid paymentId=${payment.id} sessionId=${sessionId} status=${session.payment_status}`);
    return payment.bookingId;
  }

  async handleStripeWebhook(rawBody: Buffer, signature?: string) {
    if (!this.stripe) {
      throw new BadRequestException('Stripe is not configured');
    }

    const webhookSecret = this.config.get<string>('payment.stripeWebhookSecret');
    if (!webhookSecret) {
      throw new BadRequestException('Stripe webhook secret is not configured');
    }

    if (!signature) {
      throw new BadRequestException('Missing Stripe signature header');
    }

    const event = this.stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session;
      const paymentId = session.metadata?.paymentId;
      if (!paymentId) {
        this.logger.warn(`Stripe webhook missing paymentId metadata eventId=${event.id}`);
        return { received: true };
      }

      const payment = await this.prisma.payment.findUnique({ where: { id: paymentId } });
      if (!payment) {
        this.logger.warn(`Stripe webhook payment not found paymentId=${paymentId} eventId=${event.id}`);
        return { received: true };
      }

      if (payment.status !== 'COMPLETED') {
        const gatewayTransactionId = typeof session.payment_intent === 'string'
          ? session.payment_intent
          : session.id;
        await this.markPaymentCompleted(payment, gatewayTransactionId, session);
      }
    }

    if (event.type === 'payment_intent.succeeded') {
      const intent = event.data.object as Stripe.PaymentIntent;
      const paymentId = intent.metadata?.paymentId;
      const payment = paymentId
        ? await this.prisma.payment.findUnique({ where: { id: paymentId } })
        : await this.prisma.payment.findFirst({ where: { gatewayPaymentToken: intent.id } });

      if (!payment) {
        this.logger.warn(`Stripe webhook payment not found for intent=${intent.id} eventId=${event.id}`);
        return { received: true };
      }

      if (payment.status !== 'COMPLETED') {
        await this.markPaymentCompleted(payment, intent.id, intent);
      }
    }

    if (event.type === 'payment_intent.payment_failed') {
      const intent = event.data.object as Stripe.PaymentIntent;
      const paymentId = intent.metadata?.paymentId;
      const payment = paymentId
        ? await this.prisma.payment.findUnique({ where: { id: paymentId } })
        : await this.prisma.payment.findFirst({ where: { gatewayPaymentToken: intent.id } });

      if (payment && payment.status !== 'COMPLETED') {
        await this.prisma.payment.update({
          where: { id: payment.id },
          data: {
            status: 'FAILED',
            failedAt: new Date(),
            failureReason: intent.last_payment_error?.message ?? 'Payment failed',
          },
        });
      }
    }

    return { received: true };
  }

  async handlePaystackReturn(reference: string) {
    if (!reference) {
      throw new BadRequestException('Missing Paystack reference');
    }

    const verification = await this.verifyPaystackTransaction(reference);
    if (!verification?.status || verification?.data?.status !== 'success') {
      throw new BadRequestException('Paystack payment not successful');
    }

    const metadata = verification.data.metadata ?? {};
    const paymentId = metadata.paymentId as string | undefined;
    const payment = paymentId
      ? await this.prisma.payment.findUnique({ where: { id: paymentId } })
      : await this.prisma.payment.findFirst({ where: { gatewayPaymentToken: reference } });

    if (!payment) {
      throw new NotFoundException('Payment not found');
    }

    if (payment.status !== 'COMPLETED') {
      await this.markPaymentCompleted(payment, reference, verification);
    }

    return payment.bookingId;
  }

  async handlePaystackWebhook(rawBody: Buffer, signature?: string) {
    const secret = this.config.get<string>('payment.paystackWebhookSecret');
    if (!secret) {
      throw new BadRequestException('Paystack webhook secret is not configured');
    }

    if (!signature) {
      throw new BadRequestException('Missing Paystack signature header');
    }

    const digest = crypto.createHmac('sha512', secret).update(rawBody).digest('hex');
    if (digest !== signature) {
      throw new BadRequestException('Invalid Paystack signature');
    }

    const event = JSON.parse(rawBody.toString('utf8')) as any;
    if (event?.event === 'charge.success') {
      const reference = event?.data?.reference as string | undefined;
      if (!reference) {
        return { received: true };
      }
      const payment = await this.prisma.payment.findFirst({ where: { gatewayPaymentToken: reference } });
      if (!payment) {
        this.logger.warn(`Paystack webhook payment not found reference=${reference}`);
        return { received: true };
      }
      if (payment.status !== 'COMPLETED') {
        await this.markPaymentCompleted(payment, reference, event?.data ?? event);
      }
    }

    return { received: true };
  }

  private async verifyPaystackTransaction(reference: string) {
    const paystackSecretKey = this.config.get<string>('payment.paystackSecretKey');
    if (!paystackSecretKey) {
      throw new BadRequestException('Paystack is not configured');
    }

    const response = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${paystackSecretKey}`,
      },
    });

    const data = await response.json() as any;
    if (!response.ok) {
      this.logger.error(`Paystack verify failed status=${response.status} message=${data?.message ?? 'unknown'}`);
      throw new BadRequestException(data?.message ?? 'Failed to verify Paystack payment');
    }

    return data;
  }

  async handlePayfastItn(data: Record<string, string>) {
    this.logger.log(`handlePayfastItn received m_payment_id=${data['m_payment_id']} payment_status=${data['payment_status']}`);
    const paymentId = data['m_payment_id'];
    if (!paymentId) return;

    const payment = await this.prisma.payment.findUnique({ where: { id: paymentId } });
    if (!payment) {
      this.logger.warn(`handlePayfastItn payment not found paymentId=${paymentId}`);
      return;
    }

    const status = data['payment_status'];
    const gatewayTransactionId = data['pf_payment_id'];

    if (status === 'COMPLETE') {
      this.logger.log(`PayFast payment complete paymentId=${paymentId} pf_payment_id=${gatewayTransactionId}`);
      await this.markPaymentCompleted(payment, gatewayTransactionId, data);
      return;
    }

    if (status === 'FAILED' || status === 'CANCELLED') {
      this.logger.warn(`PayFast payment failed paymentId=${paymentId} status=${status}`);
      await this.prisma.payment.update({
        where: { id: paymentId },
        data: {
          status: 'FAILED',
          gatewayTransactionId,
          gatewayResponse: data,
          failedAt: new Date(),
          failureReason: data['payment_status'] ?? 'PayFast failed',
        },
      });

      void this.notifications
        .send(
          payment.userId,
          'PAYMENT_FAILED',
          'Payment failed',
          `Your payment of R${Number(payment.amount).toFixed(2)} didn't go through. Please try again.`,
          { bookingId: payment.bookingId, type: 'payment' },
          'user',
        )
        .catch(() => undefined);
    }
  }

  async getTransactionHistory(userId: string) {
    const payments = await this.prisma.payment.findMany({
      where: { OR: [{ userId }, { providerId: userId }] },
      orderBy: { createdAt: 'desc' },
      include: { booking: true },
    });

    const serviceIds = [...new Set(payments.map((p) => p.booking.serviceId))];
    const services = await this.prisma.service.findMany({
      where: { id: { in: serviceIds } },
      select: { id: true, name: true },
    });
    const serviceNameById = new Map(services.map((s) => [s.id, s.name]));

    return payments.map((payment) => ({
      ...payment,
      serviceName: serviceNameById.get(payment.booking.serviceId) ?? null,
    }));
  }

  private async markPaymentCompleted(payment: any, gatewayTransactionId: string | undefined, gatewayResponse: unknown) {
    // Idempotency: PayFast (and other gateways) retry their callbacks, so this
    // path can be hit several times for one payment. Re-read the status and bail
    // if it is already settled — otherwise the notifications below fire 2-3x.
    const current = await this.prisma.payment.findUnique({
      where: { id: payment.id },
      select: { status: true },
    });
    if (current?.status === 'COMPLETED') {
      this.logger.log(`markPaymentCompleted: payment ${payment.id} already COMPLETED — skipping`);
      return;
    }

    // Get current booking to check status
    const booking = await this.prisma.booking.findUnique({ where: { id: payment.bookingId } });

    await this.prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: 'COMPLETED',
        gatewayTransactionId,
        paidAt: new Date(),
        gatewayResponse: gatewayResponse as any,
      },
    });

    // A "pay now" booking is held as AWAITING_PAYMENT until this point — promote
    // it to PENDING and notify the provider now that the money has landed.
    await this.bookings
      .activatePaidBooking(payment.bookingId)
      .catch((e) => this.logger.error(`activatePaidBooking failed booking=${payment.bookingId}: ${e}`));

    // Only transition to PAID if booking is currently COMPLETED
    if (booking?.status === 'COMPLETED') {
      await this.prisma.booking.update({
        where: { id: payment.bookingId },
        data: {
          status: 'PAID',
          finalPrice: payment.amount,
          commissionAmount: payment.commissionAmount,
          providerEarnings: payment.providerEarnings,
        },
      });
    } else {
      // Always update pricing fields even if not transitioning to PAID
      await this.prisma.booking.update({
        where: { id: payment.bookingId },
        data: {
          finalPrice: payment.amount,
          commissionAmount: payment.commissionAmount,
          providerEarnings: payment.providerEarnings,
        },
      });
    }

    // Do NOT credit wallet automatically here. Wait for customer to confirm completion
    this.logger.log(`Payment completed for booking ${payment.bookingId}; awaiting customer payout confirmation`);

    const amount = Number(payment.amount);
    const earnings = Number(payment.providerEarnings ?? 0);
    const notifData = { bookingId: payment.bookingId, type: 'payment_received' };
    // The money is held in escrow at this point — it is NOT in the provider's
    // wallet until the customer confirms completion (see releasePaymentToProvider).
    void this.notifications
      .send(
        payment.userId,
        'PAYMENT_RECEIVED',
        'Payment secured',
        `Your payment of R${amount.toFixed(2)} is secured. It's released to the provider once you confirm the job is done.`,
        notifData,
        'user',
      )
      .catch(() => undefined);
    void this.notifications
      .send(
        payment.providerId,
        'PAYMENT_RECEIVED',
        'Payment secured for this booking',
        `R${earnings.toFixed(2)} is held securely for this booking. It moves to your wallet once the customer confirms the job is done.`,
        notifData,
        'provider',
      )
      .catch(() => undefined);
  }

  async releasePaymentToProvider(bookingId: string, userId: string) {
    const payment = await this.prisma.payment.findUnique({ where: { bookingId } });
    if (!payment) throw new NotFoundException('Payment not found for this booking');

    // Only the customer who made the payment can release funds
    if (payment.userId !== userId) throw new BadRequestException('You do not have permission to release this payout');

    if (payment.status !== 'COMPLETED') {
      throw new BadRequestException('Payment has not been completed by the gateway');
    }

    // Ensure booking is marked completed by provider before releasing
    const booking = await this.prisma.booking.findUnique({ where: { id: payment.bookingId } });
    if (!booking) throw new NotFoundException('Booking not found');
    // Accept bookings that are explicitly COMPLETED, already PAID, or have a completedAt timestamp
    const bookingEligibleForPayout = booking.status === 'COMPLETED' || booking.status === 'PAID' || Boolean(booking.completedAt);
    if (!bookingEligibleForPayout) {
      throw new BadRequestException('Booking has not been marked completed yet');
    }

    // Check if a wallet transaction already exists for this payment (prevents double-credit)
    const existingTx = await this.prisma.walletTransaction.findUnique({ where: { paymentId: payment.id } });
    if (existingTx) {
      this.logger.log(`Payout already released for payment ${payment.id}`);
      return { status: 'RELEASED', message: 'Payout already released to provider' };
    }

    // Credit provider wallet and record transaction
    await this.wallet.credit(payment.providerId, Number(payment.providerEarnings), payment.id, `Payout approved for booking ${payment.bookingId}`);

    // Mark payment as payout released
    await this.prisma.payment.update({ where: { id: payment.id }, data: { payoutReleased: true, payoutReleasedAt: new Date(), payoutReleasedBy: userId } });

    // Transition booking to PAID if not already
    if (booking.status !== 'PAID') {
      await this.prisma.booking.update({ where: { id: booking.id }, data: { status: 'PAID', finalPrice: payment.amount, commissionAmount: payment.commissionAmount, providerEarnings: payment.providerEarnings } });
    }

    this.logger.log(`Payout released to provider for booking ${booking.id} payment ${payment.id}`);

    void this.notifications
      .send(
        payment.providerId,
        'PAYMENT_RECEIVED',
        'Payout released',
        `R${Number(payment.providerEarnings).toFixed(2)} has been added to your wallet.`,
        { bookingId: payment.bookingId, type: 'payout' },
        'provider',
      )
      .catch(() => undefined);

    return { status: 'RELEASED', message: 'Payout released to provider' };
  }

  async verifyAndConfirmPayment(bookingId: string, userId: string) {
    const payment = await this.prisma.payment.findUnique({ where: { bookingId } });
    if (!payment) {
      throw new NotFoundException('Payment not found for this booking');
    }

    if (payment.userId !== userId) {
      throw new BadRequestException('You do not have permission to verify this payment');
    }

    if (payment.status === 'COMPLETED') {
      this.logger.log(`Payment already completed paymentId=${payment.id} bookingId=${bookingId}`);
      return { status: 'COMPLETED', payment, message: 'Payment already confirmed' };
    }

    if (payment.status === 'FAILED') {
      return { status: 'FAILED', payment, message: 'Payment failed' };
    }

    if (payment.paymentGateway === 'STRIPE' && this.stripe) {
      try {
        const token = payment.gatewayPaymentToken || '';
        const stripePayment = token.startsWith('pi_')
          ? await this.stripe.paymentIntents.retrieve(token)
          : await this.stripe.checkout.sessions.retrieve(token);
        const isPaid = 'payment_status' in stripePayment
          ? stripePayment.payment_status === 'paid'
          : stripePayment.status === 'succeeded';
        if (isPaid && payment.status === 'PENDING') {
          this.logger.log(`Stripe payment confirmed via verification paymentId=${payment.id}`);
          const transactionId = 'payment_intent' in stripePayment && typeof stripePayment.payment_intent === 'string'
            ? stripePayment.payment_intent
            : stripePayment.id;
          await this.markPaymentCompleted(payment, transactionId, stripePayment);
          return { status: 'COMPLETED', payment, message: 'Payment confirmed and wallet credited' };
        }
      } catch (err) {
        this.logger.warn(`Failed to verify Stripe session paymentId=${payment.id} error=${err}`);
      }
    }

    this.logger.log(`Payment status still pending paymentId=${payment.id} gateway=${payment.paymentGateway}`);
    return { status: payment.status, payment, message: 'Payment still pending - no confirmation from gateway yet' };
  }

  async manualConfirmPayment(bookingId: string) {
    const payment = await this.prisma.payment.findUnique({ where: { bookingId } });
    if (!payment) {
      throw new NotFoundException('Payment not found for this booking');
    }

    if (payment.status === 'COMPLETED') {
      this.logger.log(`Payment already completed paymentId=${payment.id} bookingId=${bookingId}`);
      return { status: 'COMPLETED', message: 'Payment already confirmed' };
    }

    this.logger.warn(`MANUAL: Confirming payment paymentId=${payment.id} bookingId=${bookingId} gateway=${payment.paymentGateway}`);
    await this.markPaymentCompleted(payment, 'manual-confirmation', { manualConfirmation: true, timestamp: new Date().toISOString() });
    return { status: 'COMPLETED', message: 'Payment manually confirmed and wallet credited' };
  }
}
