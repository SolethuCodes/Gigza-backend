import {
  Controller,
  Post,
  Get,
  Body,
  UseGuards,
  Req,
  Res,
  HttpCode,
  HttpStatus,
  HttpException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiBody } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { RegisterProviderDto } from './dto/register-provider.dto';
import { LoginDto } from './dto/login.dto';
import { VerifyOtpDto, VerifyForgotPasswordOtpDto } from './dto/verify-otp.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { TwoFactorDto } from './dto/two-factor.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { OAuthExchangeDto } from './dto/oauth-exchange.dto';
import { SelectOAuthAccountDto } from './dto/oauth-select-account.dto';
import { CompleteOAuthSignupDto } from './dto/oauth-complete-signup.dto';
import { AppleSignInDto } from './dto/apple-signin.dto';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { GoogleAuthGuard } from './guards/google-auth.guard';
import { FacebookAuthGuard } from './guards/facebook-auth.guard';
import { VerifyPasswordDto } from './dto/verify-password.dto';
import { SetAdminPasswordDto } from './dto/set-admin-password.dto';
import { AdminChangePasswordVerifyDto, AdminChangePasswordSetDto } from './dto/admin-change-password.dto';
import { Request, Response } from 'express';

type OAuthProfile = {
  email: string;
  firstName: string;
  lastName: string;
  avatarUrl?: string;
  provider: string;
  providerAccountId: string;
};

@ApiTags('auth')
@Controller({ path: 'auth', version: '1' })
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private readonly authService: AuthService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  @Public()
  @Post('register')
  @ApiOperation({ summary: 'Register a new user (posts to the users table)' })
  register(@Body() dto: RegisterDto) {
    return this.authService.registerUser(dto);
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login with email and password (user account)' })
  login(@Body() dto: LoginDto) {
    return this.authService.loginUser(dto);
  }

  @Public()
  @Post('provider/register')
  @ApiOperation({ summary: 'Register a new provider (posts to the providers table)' })
  registerProvider(@Body() dto: RegisterProviderDto) {
    return this.authService.registerProvider(dto);
  }

  @Public()
  @Post('provider/login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login with email and password (provider account)' })
  loginProvider(@Body() dto: LoginDto) {
    return this.authService.loginProvider(dto);
  }

  @Public()
  @Post('admin/login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login with email and password (admin account)' })
  loginAdmin(@Body() dto: LoginDto) {
    return this.authService.loginAdmin(dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Post('admin/verify-password')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Re-authenticate the signed-in admin before a sensitive action' })
  verifyAdminPassword(@CurrentUser() user: AuthenticatedUser, @Body() dto: VerifyPasswordDto) {
    return this.authService.verifyAdminPassword(user.id, dto.password, dto.purpose);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Post('admin/set-password')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Set a permanent password after first sign-in with the administrator ID' })
  setAdminPassword(@CurrentUser() user: AuthenticatedUser, @Body() dto: SetAdminPasswordDto) {
    return this.authService.setAdminPassword(user.id, dto.newPassword);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Post('admin/change-password/request')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Change password step 1: email a verification code to the signed-in admin' })
  requestAdminPasswordChange(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.requestAdminPasswordChangeOtp(user.id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Post('admin/change-password/verify')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Change password step 2: verify the emailed code' })
  verifyAdminPasswordChange(@CurrentUser() user: AuthenticatedUser, @Body() dto: AdminChangePasswordVerifyDto) {
    return this.authService.verifyAdminPasswordChangeOtp(user.id, dto.code);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Post('admin/change-password/set')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Change password step 3: set the new password (within 15 min of verifying)' })
  setAdminPasswordAfterOtp(@CurrentUser() user: AuthenticatedUser, @Body() dto: AdminChangePasswordSetDto) {
    return this.authService.setAdminPasswordAfterOtp(user.id, dto.newPassword);
  }

  @Public()
  @Post('2fa/verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify 2FA code after login' })
  verifyTwoFactor(@Body() dto: TwoFactorDto) {
    return this.authService.verifyTwoFactor(dto.userId, dto.code);
  }

  @UseGuards(JwtAuthGuard)
  @Post('2fa/setup')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Initiate 2FA setup — returns secret & QR URL' })
  setupTwoFactor(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.setupTwoFactor(user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Post('2fa/enable')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Enable 2FA after verifying setup code' })
  enableTwoFactor(@CurrentUser() user: AuthenticatedUser, @Body() dto: TwoFactorDto) {
    return this.authService.enableTwoFactor(user.id, dto.code);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Refresh access token using refresh token' })
  refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refreshTokens(dto.userId, dto.refreshToken, dto.type ?? 'user');
  }

  @UseGuards(JwtAuthGuard)
  @Post('logout')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Logout and invalidate refresh token' })
  logout(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.logout(user.id, user.type);
  }

  @UseGuards(JwtAuthGuard)
  @Post('verify-email')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Verify email address with OTP' })
  verifyEmail(@CurrentUser() user: AuthenticatedUser, @Body() dto: VerifyOtpDto) {
    return this.authService.verifyEmail(user.id, dto.code, user.type);
  }

  @UseGuards(JwtAuthGuard)
  @Post('resend-email-otp')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Resend the email verification OTP' })
  resendEmailOtp(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.resendEmailVerification(user.id, user.email, user.type);
  }

  @UseGuards(JwtAuthGuard)
  @Post('verify-phone')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Verify phone number with SMS OTP' })
  verifyPhone(@CurrentUser() user: AuthenticatedUser, @Body() dto: VerifyOtpDto) {
    return this.authService.verifyPhone(user.id, dto.code, user.type);
  }

  @UseGuards(JwtAuthGuard)
  @Post('resend-phone-otp')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Resend the phone verification OTP' })
  resendPhoneOtp(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.resendPhoneVerification(user.id, user.phone, user.type);
  }

  @Public()
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Request password reset email' })
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    this.logger.log(`[Controller] Forgot password request - Email: ${dto.email}, Type: ${dto.type ?? 'user (default)'}`);
    return this.authService.forgotPassword(dto.email, dto.type ?? 'user');
  }

  @Public()
  @Post('forgot-password/verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify a password reset OTP before resetting the password' })
  verifyForgotPasswordOtp(@Body() dto: VerifyForgotPasswordOtpDto) {
    const code = dto.code ?? dto.otp;
    this.logger.log(`[Controller] Verify forgot password OTP - Email: ${dto.email}, Code provided: ${code ? 'yes' : 'no'}, Code value: ${code}`);
    return this.authService.verifyForgotPasswordOtp(dto.email, code ?? '');
  }

  @Public()
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reset password using the OTP flow (preferred) or legacy token fallback' })
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto.token, dto.newPassword, dto.email, dto.otp);
  }

  // OAuth — Google
  @Public()
  @Get('google')
  @UseGuards(GoogleAuthGuard)
  @ApiOperation({ summary: 'Initiate Google OAuth login (redirects to Google). Account type is resolved server-side.' })
  googleAuth() {}

  @Public()
  @Get('google/callback')
  @UseGuards(AuthGuard('google'))
  async googleCallback(@Req() req: Request & { user: OAuthProfile }, @Res() res: Response) {
    return this.completeOAuthRedirect(req, res);
  }

  // OAuth — Facebook
  @Public()
  @Get('facebook')
  @UseGuards(FacebookAuthGuard)
  @ApiOperation({ summary: 'Initiate Facebook OAuth login (redirects to Facebook). Account type is resolved server-side.' })
  facebookAuth() {}

  @Public()
  @Get('facebook/callback')
  @UseGuards(AuthGuard('facebook'))
  async facebookCallback(@Req() req: Request & { user: OAuthProfile }, @Res() res: Response) {
    return this.completeOAuthRedirect(req, res);
  }

  @Public()
  @Post('oauth/exchange')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Exchange a one-time OAuth callback code for access/refresh tokens' })
  @ApiBody({ type: OAuthExchangeDto })
  async exchangeOAuthCode(@Body() dto: OAuthExchangeDto) {
    const result = await this.authService.consumeOAuthExchangeCode(dto.code);
    if (!result) {
      throw new BadRequestException('Invalid or expired code');
    }
    if (typeof result === 'object' && result !== null && (result as { __oauthError?: boolean }).__oauthError) {
      const { status, message } = result as { status: number; message: string };
      throw new HttpException(message, status);
    }
    return result;
  }

  @Public()
  @Post('apple')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Native Sign in with Apple (iOS). Verifies the identity token and returns tokens, or requiresAccountSelection / requiresAccountCreation.',
  })
  @ApiBody({ type: AppleSignInDto })
  appleSignIn(@Body() dto: AppleSignInDto) {
    return this.authService.loginWithApple(dto);
  }

  @Public()
  @Post('oauth/select-account')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Complete social login by choosing a customer or provider account when both exist' })
  @ApiBody({ type: SelectOAuthAccountDto })
  selectOAuthAccount(@Body() dto: SelectOAuthAccountDto) {
    return this.authService.selectOAuthAccount(dto.selectionToken, dto.accountType);
  }

  @Public()
  @Post('oauth/complete-signup')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Create the chosen account type after a first-time social sign-in' })
  @ApiBody({ type: CompleteOAuthSignupDto })
  completeOAuthSignup(@Body() dto: CompleteOAuthSignupDto) {
    return this.authService.completeOAuthSignup(dto.creationToken, dto.role);
  }

  private async completeOAuthRedirect(req: Request & { user: OAuthProfile }, res: Response) {
    const mobileScheme = this.config.get<string>('auth.mobileAppScheme', 'errands');
    const { clientState } = await this.resolveOAuthContext(req.query['state'] as string | undefined);
    const stateParam = clientState ? `&state=${encodeURIComponent(clientState)}` : '';

    try {
      let code: string;
      try {
        const result = await this.authService.handleOAuthLogin(req.user);
        code = await this.authService.createOAuthExchangeCode(result);
      } catch (error) {
        // Login failed (e.g. suspended account) — still hand back a code so the
        // specific, user-presentable error surfaces via POST /auth/oauth/exchange
        // instead of leaking a free-text message into the deep link/URL/logs.
        if (!(error instanceof HttpException)) {
          this.logger.error('OAuth login failed with an unexpected error', error instanceof Error ? error.stack : error);
        }
        const status = error instanceof HttpException ? error.getStatus() : HttpStatus.BAD_REQUEST;
        const message = error instanceof HttpException ? error.message : 'Something went wrong signing you in';
        code = await this.authService.createOAuthExchangeCode({ __oauthError: true, status, message });
      }
      return res.redirect(`${mobileScheme}://auth/callback?code=${code}${stateParam}`);
    } catch {
      // Only reached if we couldn't even create an exchange code (e.g. Redis down)
      return res.redirect(`${mobileScheme}://auth/callback?error=oauth_failed${stateParam}`);
    }
  }

  private async resolveOAuthContext(state: string | undefined): Promise<{ clientState?: string }> {
    if (!state) return {};
    try {
      const decoded = await this.jwt.verifyAsync<{ clientState?: string }>(state, {
        secret: this.config.get<string>('auth.jwtSecret'),
      });
      return { clientState: decoded.clientState };
    } catch {
      return {};
    }
  }
}
