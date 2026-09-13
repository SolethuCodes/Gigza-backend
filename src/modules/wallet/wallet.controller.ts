import { Controller, Get, Post, Body, UseGuards, Query } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { WalletService } from './wallet.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';

@ApiTags('wallet')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('PROVIDER')
@Controller({ path: 'wallet', version: '1' })
export class WalletController {
  constructor(private readonly wallet: WalletService) {}
  @Get() @ApiOperation({ summary: 'Get wallet balance (FR-P2)' }) getBalance(@CurrentUser() u: AuthenticatedUser) { return this.wallet.getOrCreate(u.id); }
  @Get('balance') @ApiOperation({ summary: 'Quick balance (available) for dashboard' }) async getQuickBalance(@CurrentUser() u: AuthenticatedUser) {
    const w = await this.wallet.getOrCreate(u.id);
    return { available: String(w.balance ?? 0), pending: String(w.pendingBalance ?? 0) };
  }

  @Get('transactions') getTransactions(@CurrentUser() u: AuthenticatedUser) { return this.wallet.getTransactions(u.id); }
  @Get('withdrawals') getWithdrawals(@CurrentUser() u: AuthenticatedUser) { return this.wallet.getWithdrawals(u.id); }
  @Get('banks') @ApiOperation({ summary: 'Get supported Flutterwave banks for payout testing' })
  async getBanks(@Query('country') country = 'ZA') {
    return this.wallet.getFlutterwaveBanks(country);
  }

  @Post('withdraw') @ApiOperation({ summary: 'Request a withdrawal (FR-P4)' })
  requestWithdrawal(@CurrentUser() u: AuthenticatedUser, @Body() body: any) {
    const amount = typeof body?.amount === 'number' ? body.amount : Number(body?.amount ?? 0);
    // Accept both nested bankDetails or flat payload fields for compatibility
    let bankDetails = body?.bankDetails ?? null;
    if (!bankDetails) {
      bankDetails = {
        bankName: body?.bankName ?? body?.bank ?? null,
        accountNumber: body?.accountNumber ?? body?.account_number ?? null,
        accountHolder: body?.accountName ?? body?.accountHolder ?? body?.account_name ?? null,
        branchCode: body?.branchCode ?? body?.branch_code ?? null,
      };
    }
    return this.wallet.requestWithdrawal(u.id, amount, bankDetails);
  }
}
