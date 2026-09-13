import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private transporter: nodemailer.Transporter;

  constructor(private readonly config: ConfigService) {
    const host = config.get<string>('EMAIL_HOST') ?? config.get<string>('SMTP_HOST') ?? 'smtp.sendgrid.net';
    const port = Number(config.get('EMAIL_PORT') ?? config.get('SMTP_PORT') ?? 587);
    const secure = ['true', '1', 'yes'].includes(
      String(config.get('EMAIL_SECURE') ?? config.get('SMTP_SECURE') ?? 'false').toLowerCase(),
    );
    const user = config.get<string>('EMAIL_USER') ?? config.get<string>('SMTP_USER');
    const pass = config.get<string>('EMAIL_PASS') ?? config.get<string>('SMTP_PASS');
    const auth = host.includes('sendgrid.net')
      ? { user: user ?? 'apikey', pass: pass ?? '' }
      : user || pass
      ? { user: user ?? '', pass: pass ?? '' }
      : undefined;

    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      ...(auth ? { auth } : {}),
    });
  }

  private async send(options: {
    to: string;
    subject: string;
    html: string;
    text?: string;
  }) {
    const from = this.config.get('EMAIL_FROM', 'noreply@e-rrands.co.za');
    try {
      await this.transporter.sendMail({ from, ...options });
      this.logger.log(`Email sent to ${options.to}: ${options.subject}`);
    } catch (error) {
      this.logger.error(`Failed to send email to ${options.to}`, error);
      throw error;
    }
  }

  async sendAdminTest(to: string, override?: { host?: string | null; port?: number | null; user?: string | null; pass?: string | null; from?: string | null }) {
    const host = override?.host || this.config.get<string>('EMAIL_HOST') || this.config.get<string>('SMTP_HOST') || 'smtp.sendgrid.net';
    const port = Number(override?.port || this.config.get('EMAIL_PORT') || this.config.get('SMTP_PORT') || 587);
    const user = override?.user || this.config.get<string>('EMAIL_USER') || this.config.get<string>('SMTP_USER');
    const pass = override?.pass || this.config.get<string>('EMAIL_PASS') || this.config.get<string>('SMTP_PASS');
    const from =
      override?.from?.trim() ||
      this.config.get<string>('EMAIL_FROM') ||
      'noreply@e-rrands.co.za';
    const transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      ...(user || pass ? { auth: { user: user ?? '', pass: pass ?? '' } } : {}),
    });
    await transporter.sendMail({
      from,
      to,
      subject: 'E-RRANDS admin email test',
      text: 'This is a test email from the E-RRANDS admin console. Your email integration is working.',
      html: '<p>This is a test email from the E-RRANDS admin console. Your email integration is working.</p>',
    });
  }

  async sendEmailVerification(to: string, code: string) {
    await this.send({
      to,
      subject: 'Verify your E-RRANDS account',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #0D9488;">E-RRANDS — Any Service, Anytime.</h2>
          <p>Your email verification code is:</p>
          <div style="background: #F0FDFA; border: 2px solid #0D9488; border-radius: 8px; padding: 20px; text-align: center; margin: 20px 0;">
            <span style="font-size: 36px; font-weight: bold; letter-spacing: 8px; color: #0D9488;">${code}</span>
          </div>
          <p>This code expires in 10 minutes.</p>
          <p style="color: #6B7280; font-size: 12px;">If you didn't create an account with E-RRANDS, ignore this email.</p>
        </div>
      `,
    });
  }

  async sendPasswordReset(to: string, firstName: string, token: string) {
    const resetBaseUrl = this.config.get<string>('app.passwordResetUrl') ?? 'http://localhost:3000';
    const separator = resetBaseUrl.includes('?') ? '&' : '?';
    const resetUrl = `${resetBaseUrl}${separator}token=${encodeURIComponent(token)}`;
    await this.send({
      to,
      subject: 'Reset your E-RRANDS password',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #0D9488;">Password Reset Request</h2>
          <p>Hi ${firstName},</p>
          <p>We received a request to reset your password. Click the button below to continue:</p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${resetUrl}" style="background: #0D9488; color: white; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-weight: bold;">
              Reset Password
            </a>
          </div>
          <p>This link expires in 10 minutes. If you did not request this, ignore this email.</p>
        </div>
      `,
    });
  }

  async sendPasswordResetOtp(to: string, firstName: string, code: string) {
    await this.send({
      to,
      subject: 'Your E-RRANDS password reset code',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #0D9488;">Password Reset Code</h2>
          <p>Hi ${firstName},</p>
          <p>We received a request to reset your password. Use the code below in the app to continue:</p>
          <div style="background: #F0FDFA; border: 2px solid #0D9488; border-radius: 8px; padding: 20px; text-align: center; margin: 20px 0;">
            <span style="font-size: 36px; font-weight: bold; letter-spacing: 8px; color: #0D9488;">${code}</span>
          </div>
          <p>This code expires in 10 minutes. If you did not request this, ignore this email.</p>
        </div>
      `,
    });
  }

  async sendPasswordChangeOtp(to: string, firstName: string, code: string) {
    await this.send({
      to,
      subject: 'Confirm your E-RRANDS admin password change',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #0D9488;">Confirm password change</h2>
          <p>Hi ${firstName},</p>
          <p>Enter this code in the admin console to verify it's you, then choose a new password:</p>
          <div style="background: #F0FDFA; border: 2px solid #0D9488; border-radius: 8px; padding: 20px; text-align: center; margin: 20px 0;">
            <span style="font-size: 36px; font-weight: bold; letter-spacing: 8px; color: #0D9488;">${code}</span>
          </div>
          <p>This code expires in 10 minutes. If you didn't start this, ignore this email and your password stays the same.</p>
        </div>
      `,
    });
  }

  async sendKycApprovalOtp(to: string, firstName: string, providerName: string, code: string) {
    await this.send({
      to,
      subject: 'Confirm the provider verification',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #0D9488;">Confirm provider verification</h2>
          <p>Hi ${firstName},</p>
          <p>You are about to approve the KYC verification for <strong>${providerName}</strong>. Enter this code in the admin console to confirm:</p>
          <div style="background: #F0FDFA; border: 2px solid #0D9488; border-radius: 8px; padding: 20px; text-align: center; margin: 20px 0;">
            <span style="font-size: 36px; font-weight: bold; letter-spacing: 8px; color: #0D9488;">${code}</span>
          </div>
          <p>This code expires in 10 minutes. If you did not start this approval, ignore this email and review your account activity.</p>
        </div>
      `,
    });
  }

  async sendBookingConfirmation(to: string, bookingDetails: {
    firstName: string;
    bookingId: string;
    serviceName: string;
    providerName: string;
    date: string;
    price: string;
  }) {
    await this.send({
      to,
      subject: `Booking Confirmed — ${bookingDetails.serviceName}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #0D9488;">Booking Confirmed!</h2>
          <p>Hi ${bookingDetails.firstName},</p>
          <p>Your service has been booked successfully.</p>
          <table style="width: 100%; border-collapse: collapse;">
            <tr><td style="padding: 8px; border-bottom: 1px solid #E5E7EB;"><strong>Booking ID</strong></td><td>${bookingDetails.bookingId}</td></tr>
            <tr><td style="padding: 8px; border-bottom: 1px solid #E5E7EB;"><strong>Service</strong></td><td>${bookingDetails.serviceName}</td></tr>
            <tr><td style="padding: 8px; border-bottom: 1px solid #E5E7EB;"><strong>Provider</strong></td><td>${bookingDetails.providerName}</td></tr>
            <tr><td style="padding: 8px; border-bottom: 1px solid #E5E7EB;"><strong>Date</strong></td><td>${bookingDetails.date}</td></tr>
            <tr><td style="padding: 8px;"><strong>Amount</strong></td><td>R${bookingDetails.price}</td></tr>
          </table>
        </div>
      `,
    });
  }

  async sendKycApproval(to: string, firstName: string, approved: boolean, reason?: string) {
    const subject = approved ? 'Your identity is verified' : 'Identity verification update';
    await this.send({
      to,
      subject,
      html: approved
        ? `<div style="font-family: Arial, sans-serif; color: #0F1C34;"><h2 style="color: #0F1C34;">You're verified on E-RRANDS</h2><p>Hi ${escapeHtml(firstName)}, your identity check is complete. You can now appear in customer search and accept paid jobs.</p></div>`
        : `<div style="font-family: Arial, sans-serif; color: #0F1C34;"><h2>Verification needs another try</h2><p>Hi ${escapeHtml(firstName)}, we could not complete your identity check: ${escapeHtml(reason ?? 'Please restart verification in the app with a clear ID photo and selfie.')}</p></div>`,
    });
  }

  async sendAdminInvitation(params: {
    to: string;
    firstName: string;
    roleName: string;
    oneTimePassword: string;
  }) {
    const loginUrl = `${this.config.get('app.adminUrl') ?? 'http://localhost:3001'}/login`;
    const { to, firstName, roleName, oneTimePassword } = params;
    await this.send({
      to,
      subject: 'You have been given access to the E-RRANDS admin console',
      text: [
        `Hi ${firstName},`,
        '',
        'You have been invited to the E-RRANDS administrator console.',
        `Your role: ${roleName}`,
        '',
        'To sign in for the first time:',
        `  1. Open ${loginUrl}`,
        `  2. Email: ${to}`,
        `  3. Password: ${oneTimePassword}`,
        '     (this is your administrator ID — it works once)',
        '  4. You will then be asked to choose your own permanent password.',
        '',
        'If you were not expecting this email, you can ignore it.',
      ].join('\n'),
      html: `
        <!doctype html>
        <html>
          <body style="margin:0;padding:24px;background:#F5F7FA;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#0F1C34;">
            <div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #E5E7EB;">
              <div style="background:linear-gradient(118deg,#0F1C34 0%,#1A2C5B 72%,#0F1C34 100%);padding:22px 28px;">
                <p style="margin:0;font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:#BDA375;">E-RRANDS</p>
                <h1 style="margin:8px 0 0;font-size:20px;color:#ffffff;">You've been given dashboard access</h1>
              </div>
              <div style="height:2px;background:#BDA375;"></div>
              <div style="padding:28px;">
                <p style="margin:0 0 16px;">Hi ${escapeHtml(firstName)},</p>
                <p style="margin:0 0 16px;">You have been invited to the E-RRANDS administrator console.</p>
                <p style="margin:0 0 20px;">Your role: <strong>${escapeHtml(roleName)}</strong></p>
                <h2 style="margin:0 0 12px;font-size:15px;">Signing in for the first time</h2>
                <ol style="margin:0 0 20px;padding-left:20px;line-height:1.7;">
                  <li>Open the admin console with the button below.</li>
                  <li>Email: <strong>${escapeHtml(to)}</strong></li>
                  <li>Password: your <strong>administrator ID</strong> (one-time only).</li>
                  <li>You will then choose your own permanent password.</li>
                </ol>
                <div style="margin:0 0 20px;padding:14px 16px;background:#FBF8F1;border:1px solid #E8D9B5;border-radius:12px;">
                  <p style="margin:0 0 6px;font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:#8A7048;">Administrator ID / one-time password</p>
                  <p style="margin:0;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:14px;word-break:break-all;color:#0F1C34;">${escapeHtml(oneTimePassword)}</p>
                </div>
                <p style="margin:0 0 24px;">
                  <a href="${escapeHtml(loginUrl)}"
                     style="display:inline-block;background:#0F1C34;color:#ffffff;text-decoration:none;padding:11px 20px;border-radius:10px;font-weight:600;">
                    Sign in
                  </a>
                </p>
                <p style="margin:0;color:#6B7280;font-size:13px;">If you were not expecting this email, you can ignore it.</p>
              </div>
            </div>
          </body>
        </html>
      `,
    });
  }

  async sendWithdrawalReceipt(params: {
    to: string;
    firstName: string;
    amount: string;
    reference: string;
    bankAccountNumber: string;
    bankAccountHolder: string;
    bankName: string;
    completedAt: string;
  }) {
    const { to, firstName, amount, reference, bankAccountNumber, bankAccountHolder, bankName, completedAt } = params;
    await this.send({
      to,
      subject: `Payout Receipt — R${amount} ✓`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #0D9488;">Payout Successful!</h2>
          <p>Hi ${escapeHtml(firstName)},</p>
          <p>Your withdrawal has been processed and the funds have been transferred to your bank account.</p>
          
          <div style="background: #F0FDFA; border-left: 4px solid #0D9488; padding: 20px; margin: 20px 0; border-radius: 4px;">
            <table style="width: 100%; border-collapse: collapse;">
              <tr><td style="padding: 8px; font-weight: bold; width: 40%;">Amount:</td><td style="padding: 8px;">R${escapeHtml(amount)}</td></tr>
              <tr><td style="padding: 8px; font-weight: bold;">Reference:</td><td style="padding: 8px; font-family: monospace;">${escapeHtml(reference)}</td></tr>
              <tr><td style="padding: 8px; font-weight: bold;">Bank:</td><td style="padding: 8px;">${escapeHtml(bankName)}</td></tr>
              <tr><td style="padding: 8px; font-weight: bold;">Account Holder:</td><td style="padding: 8px;">${escapeHtml(bankAccountHolder)}</td></tr>
              <tr><td style="padding: 8px; font-weight: bold;">Account Number:</td><td style="padding: 8px; font-family: monospace;">*${escapeHtml(bankAccountNumber.slice(-4))}</td></tr>
              <tr><td style="padding: 8px; font-weight: bold;">Date:</td><td style="padding: 8px;">${escapeHtml(completedAt)}</td></tr>
            </table>
          </div>
          
          <p style="color: #6B7280; font-size: 12px;">The funds should appear in your account within 1-2 business days. If you don't see the transfer, please contact support with your reference number.</p>
          <p style="color: #6B7280; font-size: 12px; margin-top: 20px;">E-RRANDS Team</p>
        </div>
      `,
    });
  }
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
