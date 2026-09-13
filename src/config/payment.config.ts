import { registerAs } from '@nestjs/config';

export default registerAs('payment', () => {
  const payfastReturnUrl = process.env['PAYFAST_RETURN_URL'];
  const payfastCancelUrl = process.env['PAYFAST_CANCEL_URL'];

  return {
  commissionRate: parseFloat(process.env['COMMISSION_RATE'] ?? '0.15'), // OI-1: 15% default, pending client confirmation
  minimumWithdrawal: parseFloat(process.env['MINIMUM_WITHDRAWAL'] ?? '100'), // ZAR
  withdrawalProcessingDays: parseInt(process.env['WITHDRAWAL_PROCESSING_DAYS'] ?? '2', 10),
  currency: process.env['CURRENCY'] ?? 'ZAR',

  // Flutterwave (payouts / bank transfers)
  flwClientId: process.env['FLW_CLIENT_ID'],
  flwClientSecret: process.env['FLW_CLIENT_SECRET'],
  flwBaseUrl: process.env['FLW_BASE_URL'] ?? 'https://developersandbox-api.flutterwave.com',
  flwIdentityUrl: process.env['FLW_IDENTITY_URL'] ?? 'https://idp.flutterwave.com/realms/flutterwave/protocol/openid-connect/token',
  flwWebhookSecret: process.env['FLW_WEBHOOK_SECRET'] ?? process.env['FLW_CLIENT_SECRET'],
  flwScenarioKey: process.env['FLW_SCENARIO_KEY'] ?? 'scenario:successful',

  // PayFast (primary SA gateway) — OI-3
  payfastMerchantId: process.env['PAYFAST_MERCHANT_ID'],
  payfastMerchantKey: process.env['PAYFAST_MERCHANT_KEY'],
  payfastPassphrase: process.env['PAYFAST_PASSPHRASE'],
  payfastSandbox: process.env['PAYFAST_SANDBOX'] !== 'false',
  payfastNotifyUrl: process.env['PAYFAST_NOTIFY_URL'],
  payfastReturnUrl: payfastReturnUrl,
  payfastCancelUrl: payfastCancelUrl,
  payfastPaymentMethod: process.env['PAYFAST_PAYMENT_METHOD'] ?? 'cc',

  // Stripe (international fallback)
  stripeSecretKey: process.env['STRIPE_SECRET_KEY'],
  stripeWebhookSecret: process.env['STRIPE_WEBHOOK_SECRET'],
  stripePublishableKey: process.env['STRIPE_PUBLISHABLE_KEY'],
  stripeReturnUrl: process.env['STRIPE_RETURN_URL']
    ?? payfastReturnUrl?.replace('/payfast/return', '/stripe/return'),
  stripeCancelUrl: process.env['STRIPE_CANCEL_URL']
    ?? payfastCancelUrl?.replace('/payfast/cancel', '/stripe/cancel'),

  // Paystack (Africa)
  paystackSecretKey: process.env['PAYSTACK_SECRET_KEY'],
  paystackPublicKey: process.env['PAYSTACK_PUBLIC_KEY'],
  paystackReturnUrl: process.env['PAYSTACK_RETURN_URL']
    ?? payfastReturnUrl?.replace('/payfast/return', '/paystack/return'),
  paystackWebhookSecret: process.env['PAYSTACK_WEBHOOK_SECRET'] ?? process.env['PAYSTACK_SECRET_KEY'],
  };
});
