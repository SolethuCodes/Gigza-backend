import { Controller, Get, Post, Param, Body, UseGuards, Query, Res, Logger, Req, Headers } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { PaymentsService } from './payments.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import type { Request, Response } from 'express';

@ApiTags('payments')
@Controller({ path: 'payments', version: '1' })
export class PaymentsController {
  private readonly logger = new Logger(PaymentsController.name);

  constructor(private readonly payments: PaymentsService) {}

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('breakdown/:bookingId')
  @ApiOperation({ summary: 'Get payment breakdown for a booking (FR-P3)' })
  breakdown(@Param('bookingId') bookingId: string) { return this.payments.getBreakdown(bookingId); }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('payfast/initiate/:bookingId')
  @ApiOperation({ summary: 'Initiate PayFast payment for a booking' })
  async initiatePayfast(@Param('bookingId') bookingId: string, @CurrentUser() user: AuthenticatedUser) {
    this.logger.log(`initiatePayfast bookingId=${bookingId} userId=${user.id}`);
    const result = await this.payments.initiatePayfast(bookingId, user.id);
    this.logger.log(`initiatePayfast completed paymentId=${(result as any)?.paymentId}`);
    return result;
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('stripe/initiate/:bookingId')
  @ApiOperation({ summary: 'Initiate Stripe hosted checkout for a booking' })
  async initiateStripe(@Param('bookingId') bookingId: string, @CurrentUser() user: AuthenticatedUser) {
    this.logger.log(`initiateStripe bookingId=${bookingId} userId=${user.id}`);
    const result = await this.payments.initiateStripe(bookingId, user.id);
    this.logger.log(`initiateStripe completed paymentId=${(result as any)?.paymentId}`);
    return result;
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('stripe/payment-intent/:bookingId')
  @ApiOperation({ summary: 'Create a Stripe PaymentIntent for native wallet payments (Apple Pay / Google Pay / card)' })
  async createStripePaymentIntent(@Param('bookingId') bookingId: string, @CurrentUser() user: AuthenticatedUser) {
    this.logger.log(`createStripePaymentIntent bookingId=${bookingId} userId=${user.id}`);
    const result = await this.payments.createStripePaymentIntent(bookingId, user.id);
    this.logger.log(`createStripePaymentIntent completed paymentId=${(result as any)?.paymentId}`);
    return result;
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('paystack/initiate/:bookingId')
  @ApiOperation({ summary: 'Initiate Paystack hosted checkout for a booking' })
  async initiatePaystack(@Param('bookingId') bookingId: string, @CurrentUser() user: AuthenticatedUser) {
    this.logger.log(`initiatePaystack bookingId=${bookingId} userId=${user.id}`);
    const result = await this.payments.initiatePaystack(bookingId, user.id);
    this.logger.log(`initiatePaystack completed paymentId=${(result as any)?.paymentId}`);
    return result;
  }

  @Public()
  @Post('payfast/itn')
  @ApiOperation({ summary: 'PayFast Instant Transfer Notification webhook' })
  payfastItn(@Body() body: Record<string, string>) {
    this.logger.log('payfastItn received', JSON.stringify(body));
    return this.payments.handlePayfastItn(body);
  }

  @Public()
  @Get('payfast/checkout/:paymentId')
  @ApiOperation({ summary: 'Render PayFast checkout form and redirect to gateway' })
  async payfastCheckout(@Param('paymentId') paymentId: string, @Res() res: Response) {
    this.logger.log(`payfastCheckout requested paymentId=${paymentId}`);
    const html = await this.payments.getPayfastCheckoutHtml(paymentId);
    res.setHeader('Content-Type', 'text/html');
    return res.send(html);
  }

  @Public()
  @Get('payfast/return')
  @ApiOperation({ summary: 'PayFast web return redirect to app' })
  payfastReturn(@Query('bookingId') bookingId: string, @Res() res: Response) {
    this.logger.log(`payfastReturn bookingId=${bookingId}`);
    return this.sendAppRedirect(res, 'success', bookingId);
  }

  @Public()
  @Get('payfast/cancel')
  @ApiOperation({ summary: 'PayFast web cancel redirect to app' })
  payfastCancel(@Query('bookingId') bookingId: string, @Res() res: Response) {
    this.logger.log(`payfastCancel bookingId=${bookingId}`);
    return this.sendAppRedirect(res, 'cancel', bookingId);
  }

  @Public()
  @Post('stripe/webhook')
  @ApiOperation({ summary: 'Stripe signed webhook endpoint' })
  stripeWebhook(@Req() req: Request, @Headers('stripe-signature') signature?: string) {
    this.logger.log(`stripeWebhook received signature=${signature ? 'present' : 'missing'}`);
    return this.payments.handleStripeWebhook(req.body as Buffer, signature);
  }

  @Public()
  @Post('paystack/webhook')
  @ApiOperation({ summary: 'Paystack signed webhook endpoint' })
  paystackWebhook(@Req() req: Request, @Headers('x-paystack-signature') signature?: string) {
    this.logger.log(`paystackWebhook received signature=${signature ? 'present' : 'missing'}`);
    return this.payments.handlePaystackWebhook(req.body as Buffer, signature);
  }

  @Public()
  @Get('paystack/return')
  @ApiOperation({ summary: 'Paystack hosted checkout return redirect to app' })
  async paystackReturn(@Query('bookingId') bookingId: string, @Query('reference') reference: string, @Res() res: Response) {
    this.logger.log(`paystackReturn bookingId=${bookingId} reference=${reference}`);
    const resolvedBookingId = await this.payments.handlePaystackReturn(reference);
    return this.sendAppRedirect(res, 'success', resolvedBookingId || bookingId);
  }

  @Public()
  @Get('stripe/return')
  @ApiOperation({ summary: 'Stripe hosted checkout return redirect to app' })
  async stripeReturn(@Query('bookingId') bookingId: string, @Query('session_id') sessionId: string, @Res() res: Response) {
    this.logger.log(`stripeReturn bookingId=${bookingId} sessionId=${sessionId}`);
    const resolvedBookingId = await this.payments.handleStripeReturn(sessionId);
    return this.sendAppRedirect(res, 'success', resolvedBookingId || bookingId);
  }

  @Public()
  @Get('stripe/cancel')
  @ApiOperation({ summary: 'Stripe hosted checkout cancel redirect to app' })
  stripeCancel(@Query('bookingId') bookingId: string, @Res() res: Response) {
    this.logger.log(`stripeCancel bookingId=${bookingId}`);
    return this.sendAppRedirect(res, 'cancel', bookingId);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('history')
  @ApiOperation({ summary: 'Get transaction history (FR-P5)' })
  history(@CurrentUser() user: AuthenticatedUser) { return this.payments.getTransactionHistory(user.id); }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('verify/:bookingId')
  @ApiOperation({ summary: 'Verify and confirm payment status after return from gateway (FR-P6)' })
  async verifyPayment(@Param('bookingId') bookingId: string, @CurrentUser() user: AuthenticatedUser) {
    this.logger.log(`verifyPayment bookingId=${bookingId} userId=${user.id}`);
    return this.payments.verifyAndConfirmPayment(bookingId, user.id);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('confirm-payout/:bookingId')
  @ApiOperation({ summary: 'Customer confirms job completion and releases payout to provider' })
  async confirmPayout(@Param('bookingId') bookingId: string, @CurrentUser() user: AuthenticatedUser) {
    this.logger.log(`confirmPayout bookingId=${bookingId} userId=${user.id}`);
    return this.payments.releasePaymentToProvider(bookingId, user.id);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Post('manual-confirm/:bookingId')
  @ApiOperation({ summary: 'Manually mark a payment complete (admin only — support tooling)' })
  async manualConfirmPayment(@Param('bookingId') bookingId: string, @CurrentUser() user: AuthenticatedUser) {
    this.logger.warn(`manualConfirmPayment bookingId=${bookingId} by admin=${user.id}`);
    return this.payments.manualConfirmPayment(bookingId);
  }

  private sendAppRedirect(res: Response, outcome: 'success' | 'cancel', bookingId?: string) {
    const bookingParam = bookingId ? `?bookingId=${encodeURIComponent(bookingId)}` : '';
    const schemeUrl = `errands://payment/${outcome}${bookingParam}`;
    const intentUrl = `intent://payment/${outcome}${bookingParam}#Intent;scheme=errands;package=co.za.errands.app;end`;
    res.setHeader('Content-Type', 'text/html');
    return res.send(`<!doctype html><html><head><meta charset="utf-8" /><title>Returning to app</title><style>body{font-family:sans-serif;padding:24px;background:#f8fafc;color:#0f172a;}a.button{display:inline-block;margin-top:24px;padding:14px 20px;background:#0d9488;color:white;border-radius:12px;text-decoration:none;}p{max-width:600px;line-height:1.65;}</style></head><body><h1>Returning to the app</h1><p>If the app does not open automatically, tap the button below to continue.</p><p><strong>${outcome === 'success' ? 'Return' : 'Cancel'} URL:</strong><br/>${schemeUrl}</p><a class="button" href="${schemeUrl}">Open E-RRANDS</a><script>const url = /Android/i.test(navigator.userAgent) ? '${intentUrl}' : '${schemeUrl}'; window.location.replace(url); setTimeout(() => window.location.replace('${schemeUrl}'), 500);</script></body></html>`);
  }
}
