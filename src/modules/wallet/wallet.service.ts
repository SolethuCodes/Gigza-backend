import { Injectable, BadRequestException, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';
import { EmailService } from '../../services/email/email.service';

@Injectable()
export class WalletService {
  private readonly logger = new Logger(WalletService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly email: EmailService,
  ) {}

  async getOrCreate(providerId: string) {
    return this.prisma.wallet.upsert({ where: { providerId }, update: {}, create: { providerId } });
  }

  async credit(providerId: string, amount: number, paymentId: string, description: string) {
    const wallet = await this.getOrCreate(providerId);
    const before = Number(wallet.balance);
    const after = before + amount;
    await this.prisma.wallet.update({ where: { id: wallet.id }, data: { balance: after, totalEarned: { increment: amount } } });
    await this.prisma.walletTransaction.create({ data: { walletId: wallet.id, paymentId, type: 'CREDIT', amount, balanceBefore: before, balanceAfter: after, description } });
  }

  private normalizeBankDetails(raw: any) {
    if (!raw) throw new BadRequestException('Bank details are required for withdrawal');

    const bankName = raw.bankName ?? raw.bank ?? raw.bank_name ?? raw.name ?? null;
    const accountNumber = raw.accountNumber ?? raw.account_number ?? raw.accountNo ?? null;
    const accountHolder = raw.accountHolder ?? raw.accountName ?? raw.account_name ?? raw.accountOwner ?? null;
    const bankCode = raw.bankCode ?? raw.bank_code ?? raw.branchCode ?? raw.branch_code ?? null;

    if (!bankName || !accountNumber || !accountHolder) {
      throw new BadRequestException('Bank details must include bankName, accountNumber, and accountHolder');
    }

    return {
      bankName: String(bankName).trim(),
      accountNumber: String(accountNumber).trim(),
      accountHolder: String(accountHolder).trim(),
      bankCode: bankCode ? String(bankCode).trim() : '',
      currency: 'ZAR',
      country: 'ZA',
    };
  }

  private getFallbackSouthAfricanBanks() {
    return [
      { name: 'Standard Bank', code: '051' },
      { name: 'First National Bank', code: '250655' },
      { name: 'FNB', code: '250655' },
      { name: 'ABSA', code: '632005' },
      { name: 'Capitec', code: '430000' },
      { name: 'Nedbank', code: '198765' },
      { name: 'Investec', code: '580105' },
      { name: 'TymeBank', code: '678910' },
    ];
  }

  private async resolveBankCodeFromFlutterwave(bankName: string, fallbackBankCode?: string | null) {
    const candidateCode = fallbackBankCode?.trim();
    if (candidateCode && candidateCode !== '000000' && !/^0+$/.test(candidateCode) && candidateCode.length >= 3) {
      const fallback = this.getFallbackSouthAfricanBanks().find((bank) =>
        bank.code === candidateCode || bank.name.toLowerCase() === bankName.toLowerCase(),
      );
      if (fallback) return fallback.code;
    }

    try {
      const banks = await this.getFlutterwaveBanks('ZA');
      const normalizedName = bankName.toLowerCase().replace(/[^a-z0-9]/g, '');
      const match = banks.find((bank: any) => {
        const bankNameText = String(bank?.name ?? bank?.bank_name ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
        const codeText = String(bank?.code ?? bank?.bank_code ?? '').toLowerCase();
        return bankNameText.includes(normalizedName) || normalizedName.includes(bankNameText) || codeText === candidateCode;
      });

      const resolvedCode = match?.code ?? match?.bank_code ?? null;
      if (resolvedCode) {
        return String(resolvedCode);
      }
    } catch (error) {
      this.logger.warn(`Flutterwave bank list unavailable for ${bankName}; using fallback South African bank map: ${error instanceof Error ? error.message : String(error)}`);
    }

    const fallbackMatch = this.getFallbackSouthAfricanBanks().find((bank) => {
      const normalizedFallback = bank.name.toLowerCase().replace(/[^a-z0-9]/g, '');
      const normalizedInput = bankName.toLowerCase().replace(/[^a-z0-9]/g, '');
      return normalizedFallback.includes(normalizedInput) || normalizedInput.includes(normalizedFallback);
    });

    if (fallbackMatch) {
      return fallbackMatch.code;
    }

    throw new BadRequestException('Unable to find a valid Flutterwave bank code for the selected bank. Please choose a supported bank from the list.');
  }

  private buildReference() {
    const now = new Date();
    const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
    const suffix = Math.random().toString(36).slice(2, 8).toUpperCase();
    return `WD-${stamp}-${suffix}`;
  }

  private async getFlutterwaveToken() {
    const clientId = this.config.get<string>('payment.flwClientId');
    const clientSecret = this.config.get<string>('payment.flwClientSecret');
    const identityUrl = this.config.get<string>('payment.flwIdentityUrl', 'https://idp.flutterwave.com/realms/flutterwave/protocol/openid-connect/token');

    if (!clientId || !clientSecret) {
      throw new BadRequestException('Flutterwave credentials are not configured');
    }

    const response = await fetch(identityUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'client_credentials',
      }),
    });

    const data: any = await response.json();
    if (!response.ok || !data?.access_token) {
      throw new BadRequestException(data?.error_description ?? 'Failed to authenticate with Flutterwave');
    }

    return data.access_token as string;
  }

  private async resolveFlutterwaveBankAccount(bankCode: string, accountNumber: string) {
    const baseUrl = this.config.get<string>('payment.flwBaseUrl', 'https://developersandbox-api.flutterwave.com');
    const token = await this.getFlutterwaveToken();

    try {
      const response = await fetch(`${baseUrl}/banks/account-resolve`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          account: {
            code: bankCode,
            number: accountNumber,
          },
        }),
      });

      const data: any = await response.json();
      if (response.ok && data?.data) {
        return data.data;
      }

      const message = data?.error?.message ?? data?.message ?? 'Bank account verification failed';
      this.logger.warn(`Flutterwave account resolution failed for bankCode=${bankCode} accountNumber=${accountNumber}: ${message}`);
      throw new BadRequestException(message);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Flutterwave account resolution error: ${message}`);
      throw new BadRequestException(message);
    }
  }

  private getFlutterwaveScenarioHeader() {
    const baseUrl = this.config.get<string>('payment.flwBaseUrl', 'https://developersandbox-api.flutterwave.com');
    if (!baseUrl.includes('developersandbox')) {
      return undefined;
    }
    return this.config.get<string>('payment.flwScenarioKey') ?? 'scenario:successful';
  }

  async getFlutterwaveBanks(countryCode = 'ZA') {
    const baseUrl = this.config.get<string>('payment.flwBaseUrl', 'https://developersandbox-api.flutterwave.com');
    const token = await this.getFlutterwaveToken();
    const fallbackBanks = this.getFallbackSouthAfricanBanks();

    try {
      const response = await fetch(`${baseUrl}/banks?country=${countryCode}`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      const data: any = await response.json();
      if (response.ok) {
        const banks = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : null;
        if (banks && banks.length > 0) {
          return banks;
        }
      }

      this.logger.warn(`Flutterwave bank list fetch failed for ${countryCode}: ${JSON.stringify(data)}`);
      return fallbackBanks;
    } catch (error) {
      this.logger.warn(`Flutterwave bank list request error for ${countryCode}: ${error instanceof Error ? error.message : String(error)}`);
      return fallbackBanks;
    }
  }

  private async createFlutterwaveTransfer(withdrawal: any) {
    const baseUrl = this.config.get<string>('payment.flwBaseUrl', 'https://developersandbox-api.flutterwave.com');
    const token = await this.getFlutterwaveToken();
    const bankDetails = withdrawal.bankDetails as any;
    const traceId = `wd-${withdrawal.id}`;
    const scenarioKey = this.getFlutterwaveScenarioHeader();
    const amount = Number(withdrawal.amount);

    const body = {
      payment_instruction: {
        currency: 'ZAR',
        amount,
        recipient: {
          name: bankDetails.accountHolder,
          account: {
            number: bankDetails.accountNumber,
            code: bankDetails.bankCode,
          },
        },
      },
      narration: `Errands payout ${withdrawal.reference}`,
      reference: withdrawal.reference,
    };

    try {
      const response = await fetch(`${baseUrl}/direct-transfers`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'X-Trace-Id': traceId,
          'X-Idempotency-Key': withdrawal.idempotencyKey ?? withdrawal.reference,
          ...(scenarioKey ? { 'X-Scenario-Key': scenarioKey } : {}),
        },
        body: JSON.stringify(body),
      });

      const data: any = await response.json();
      if (response.ok) {
        return data;
      }

      const message = data?.error?.message ?? data?.message ?? 'Flutterwave transfer creation failed';
      this.logger.error(`Flutterwave transfer failed: ${message}`);
      throw new BadRequestException(message);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Flutterwave transfer request error: ${message}`);
      throw new BadRequestException(message);
    }
  }

  private async releaseReservedWithdrawalBalance(withdrawal: any, reason: string) {
    await this.prisma.$transaction(async (tx) => {
      await tx.wallet.update({
        where: { id: withdrawal.walletId },
        data: {
          balance: { increment: Number(withdrawal.amount) },
          pendingBalance: { decrement: Number(withdrawal.amount) },
          reservedBalance: { decrement: Number(withdrawal.amount) },
        },
      });
      await tx.withdrawalRequest.update({
        where: { id: withdrawal.id },
        data: {
          status: 'FAILED',
          failureReason: reason,
          updatedAt: new Date(),
        },
      });
    });
  }

  async requestWithdrawal(providerId: string, amount: number, bankDetails: any) {
    const provider = await this.prisma.provider.findUnique({
      where: { id: providerId },
      select: { id: true, isActive: true, isBanned: true, kycStatus: true },
    });

    if (!provider || !provider.isActive || provider.isBanned || provider.kycStatus !== 'APPROVED') {
      throw new BadRequestException('Provider is not eligible to withdraw funds');
    }

    const minPayout = this.config.get<number>('payment.minimumWithdrawal', 100);
    const normalizedBank = this.normalizeBankDetails(bankDetails);
    normalizedBank.bankCode = await this.resolveBankCodeFromFlutterwave(normalizedBank.bankName, normalizedBank.bankCode);
    const numericAmount = Number(amount ?? 0);

    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      throw new BadRequestException('Withdrawal amount must be greater than zero');
    }
    if (numericAmount < minPayout) {
      throw new BadRequestException(`Minimum withdrawal is R${minPayout}`);
    }

    const wallet = await this.getOrCreate(providerId);
    if (Number(wallet.balance) < numericAmount) {
      throw new BadRequestException('Insufficient available balance');
    }

    const idempotencyKey = `wd:${providerId}:${numericAmount.toFixed(2)}:${new Date().toISOString().slice(0, 10)}`;
    const existing = await this.prisma.withdrawalRequest.findFirst({
      where: {
        providerId,
        idempotencyKey,
      },
    });
    if (existing) {
      return existing;
    }

    const reference = this.buildReference();
    const created = await this.prisma.$transaction(async (tx) => {
      const walletRow = await tx.wallet.findUnique({ where: { providerId }, select: { id: true, balance: true, pendingBalance: true, reservedBalance: true } });
      if (!walletRow) throw new BadRequestException('Wallet not found');
      if (Number(walletRow.balance) < numericAmount) {
        throw new BadRequestException('Insufficient available balance');
      }

      const duplicate = await tx.withdrawalRequest.findFirst({ where: { providerId, idempotencyKey } });
      if (duplicate) {
        return duplicate;
      }

      this.logger.debug(`Withdrawal: reserving R${numericAmount} from balance. Before: balance=${walletRow.balance}, pending=${walletRow.pendingBalance}, reserved=${walletRow.reservedBalance}`);
      const updated = await tx.wallet.update({
        where: { id: walletRow.id },
        data: {
          balance: { decrement: numericAmount },
          pendingBalance: { increment: numericAmount },
          reservedBalance: { increment: numericAmount },
        },
        select: { id: true, balance: true, pendingBalance: true, reservedBalance: true },
      });
      this.logger.debug(`Withdrawal: balance reserved. After: balance=${updated.balance}, pending=${updated.pendingBalance}, reserved=${updated.reservedBalance}`);

      return tx.withdrawalRequest.create({
        data: {
          walletId: walletRow.id,
          providerId,
          amount: numericAmount,
          currency: 'ZAR',
          bankDetails: normalizedBank,
          status: 'PENDING',
          reference,
          idempotencyKey,
          gatewayReference: reference,
          minimumPayoutMet: true,
        },
      });
    });

    try {
      const bankResolution = await this.resolveFlutterwaveBankAccount(normalizedBank.bankCode, normalizedBank.accountNumber);
      if (!bankResolution?.data?.account_name && !bankResolution?.data?.accountName) {
        throw new BadRequestException('Bank account verification failed');
      }

      const transfer = await this.createFlutterwaveTransfer(created);
      const transferData: any = transfer?.data ?? transfer;
      const updated = await this.prisma.withdrawalRequest.update({
        where: { id: created.id },
        data: {
          status: 'PROCESSING',
          flutterwaveTransferId: transferData?.id ? String(transferData.id) : null,
          flutterwaveReference: transferData?.reference ?? transferData?.tx_ref ?? created.reference,
          processedAt: new Date(),
          updatedAt: new Date(),
        },
      });

      // Get the updated wallet to show current balance
      const updatedWallet = await this.getOrCreate(providerId);
      this.logger.debug(`Withdrawal ${created.reference} moved to PROCESSING. Current wallet balance=${updatedWallet.balance}, pending=${updatedWallet.pendingBalance}`);

      return { 
        ...updated, 
        status: 'PROCESSING', 
        flutterwaveTransferId: transferData?.id ?? null, 
        flutterwaveReference: transferData?.reference ?? created.reference,
        walletBalance: String(updatedWallet.balance),
        walletPending: String(updatedWallet.pendingBalance),
      };
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Flutterwave payout failed';
      await this.prisma.$transaction(async (tx) => {
        await tx.wallet.update({
          where: { id: created.walletId },
          data: {
            balance: { increment: Number(created.amount) },
            pendingBalance: { decrement: Number(created.amount) },
            reservedBalance: { decrement: Number(created.amount) },
          },
        });
        await tx.withdrawalRequest.update({
          where: { id: created.id },
          data: {
            status: 'FAILED',
            failureReason: reason,
            rejectedAt: new Date(),
            updatedAt: new Date(),
          },
        });
      });
      throw new BadRequestException(reason);
    }
  }

  async getTransactions(providerId: string) {
    const wallet = await this.getOrCreate(providerId);
    return this.prisma.walletTransaction.findMany({ where: { walletId: wallet.id }, orderBy: { createdAt: 'desc' } });
  }

  async getWithdrawals(providerId: string) {
    return this.prisma.withdrawalRequest.findMany({ where: { providerId }, orderBy: { createdAt: 'desc' } });
  }

  async getWithdrawal(providerId: string, withdrawalId: string) {
    const withdrawal = await this.prisma.withdrawalRequest.findFirst({
      where: { id: withdrawalId, providerId },
    });
    if (!withdrawal) throw new NotFoundException('Withdrawal not found');
    return withdrawal;
  }

  async handleFlutterwaveWebhook(rawBody: Buffer | undefined, signature: string | undefined, payload: any) {
    const secret = this.config.get<string>('payment.flwWebhookSecret');
    if (!secret) {
      throw new BadRequestException('Flutterwave webhook secret is not configured');
    }
    if (!rawBody || !signature) {
      throw new BadRequestException('Missing Flutterwave signature');
    }

    const expected = createHmac('sha256', secret).update(rawBody).digest('base64');
    const expectedBuffer = Buffer.from(expected, 'utf8');
    const actualBuffer = Buffer.from(signature.trim(), 'utf8');

    if (expectedBuffer.length !== actualBuffer.length || !timingSafeEqual(expectedBuffer, actualBuffer)) {
      throw new BadRequestException('Invalid Flutterwave signature');
    }

    const event = payload?.event ?? payload?.data?.event;
    const reference = payload?.data?.reference ?? payload?.reference ?? payload?.data?.tx_ref ?? payload?.tx_ref;
    const transferId = payload?.data?.id ?? payload?.id;
    const status = payload?.data?.status ?? payload?.status ?? 'UNKNOWN';

    if (!reference) {
      return { received: true };
    }

    const withdrawal = await this.prisma.withdrawalRequest.findFirst({
      where: { reference },
    });

    if (!withdrawal) {
      this.logger.warn(`Flutterwave webhook for unknown withdrawal reference=${reference}`);
      return { received: true };
    }

    if (['SUCCESSFUL', 'FAILED', 'REVERSED', 'CANCELLED'].includes(withdrawal.status as string)) {
      return { received: true, status: withdrawal.status };
    }

    const normalizedStatus = status.toUpperCase();
    const result = await this.prisma.$transaction(async (tx) => {
      const freshWithdrawal = await tx.withdrawalRequest.findUnique({ where: { id: withdrawal.id } });
      if (!freshWithdrawal || ['SUCCESSFUL', 'FAILED', 'REVERSED', 'CANCELLED'].includes(freshWithdrawal.status as string)) {
        this.logger.debug(`Webhook: withdrawal already in final state ${freshWithdrawal?.status}`);
        return freshWithdrawal;
      }

      const amount = Number(freshWithdrawal.amount);
      const walletBefore = await tx.wallet.findUnique({ where: { id: freshWithdrawal.walletId }, select: { balance: true, pendingBalance: true, reservedBalance: true, totalWithdrawn: true } });
      
      if (['SUCCESSFUL', 'COMPLETED'].includes(normalizedStatus)) {
        this.logger.debug(`Webhook: marking withdrawal ${withdrawal.reference} as SUCCESSFUL. Wallet before: balance=${walletBefore?.balance}, pending=${walletBefore?.pendingBalance}, reserved=${walletBefore?.reservedBalance}`);
        
        const updated = await tx.wallet.update({
          where: { id: freshWithdrawal.walletId },
          data: {
            pendingBalance: { decrement: amount },
            reservedBalance: { decrement: amount },
            totalWithdrawn: { increment: amount },
          },
          select: { balance: true, pendingBalance: true, reservedBalance: true, totalWithdrawn: true },
        });
        
        this.logger.debug(`Webhook: withdrawal marked SUCCESSFUL. Wallet after: balance=${updated.balance}, pending=${updated.pendingBalance}, reserved=${updated.reservedBalance}, totalWithdrawn=${updated.totalWithdrawn}`);
        
        return tx.withdrawalRequest.update({
          where: { id: freshWithdrawal.id },
          data: {
            status: 'SUCCESSFUL',
            flutterwaveReference: reference,
            flutterwaveTransferId: transferId ? String(transferId) : freshWithdrawal.flutterwaveTransferId,
            completedAt: new Date(),
            failureReason: null,
            updatedAt: new Date(),
          },
        });
      }

      if (['FAILED', 'REVERSED', 'CANCELLED'].includes(normalizedStatus)) {
        this.logger.debug(`Webhook: marking withdrawal ${withdrawal.reference} as ${normalizedStatus}. Refunding R${amount} back to balance.`);
        
        const updated = await tx.wallet.update({
          where: { id: freshWithdrawal.walletId },
          data: {
            balance: { increment: amount },
            pendingBalance: { decrement: amount },
            reservedBalance: { decrement: amount },
          },
          select: { balance: true, pendingBalance: true, reservedBalance: true },
        });
        
        this.logger.debug(`Webhook: withdrawal marked ${normalizedStatus}. Wallet after refund: balance=${updated.balance}, pending=${updated.pendingBalance}, reserved=${updated.reservedBalance}`);
        
        return tx.withdrawalRequest.update({
          where: { id: freshWithdrawal.id },
          data: {
            status: normalizedStatus === 'REVERSED' ? 'REVERSED' : 'FAILED',
            failureReason: `Flutterwave ${normalizedStatus.toLowerCase()}`,
            rejectedAt: new Date(),
            updatedAt: new Date(),
          },
        });
      }

      return tx.withdrawalRequest.update({
        where: { id: freshWithdrawal.id },
        data: {
          status: 'PROCESSING',
          flutterwaveTransferId: transferId ? String(transferId) : freshWithdrawal.flutterwaveTransferId,
          flutterwaveReference: reference,
          updatedAt: new Date(),
        },
      });
    });

    // Send email receipt if withdrawal was successful
    if (result?.status === 'SUCCESSFUL') {
      const provider = await this.prisma.provider.findUnique({ where: { id: withdrawal.providerId } });
      if (provider) {
        const bankDetails = withdrawal.bankDetails as any;
        await this.email.sendWithdrawalReceipt({
          to: provider.email,
          firstName: provider.firstName,
          amount: String(Number(withdrawal.amount).toFixed(2)),
          reference: withdrawal.reference,
          bankAccountNumber: String(bankDetails?.accountNumber ?? ''),
          bankAccountHolder: String(bankDetails?.accountHolder ?? ''),
          bankName: String(bankDetails?.bankName ?? ''),
          completedAt: new Date().toLocaleDateString('en-ZA', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
        }).catch((err) => {
          this.logger.warn(`Failed to send withdrawal receipt email to ${provider.email}: ${err instanceof Error ? err.message : String(err)}`);
        });
      }
    }

    return { received: true, status: result?.status ?? 'PROCESSING' };
  }
}
