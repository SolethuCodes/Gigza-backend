import {
  Controller,
  Get,
  Patch,
  Put,
  Body,
  UseGuards,
  Post,
  Delete,
  Param,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiBody } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { DeleteAccountDto } from './dto/delete-account.dto';

@ApiTags('users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller({ path: 'users', version: '1' })
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('me')
  @ApiOperation({ summary: 'Get current user profile' })
  getMe(@CurrentUser() user: AuthenticatedUser) {
    return this.users.findById(user.id);
  }

  @Patch('me')
  @ApiOperation({ summary: 'Update current user profile' })
  updateMe(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { firstName?: string; lastName?: string; avatarUrl?: string },
  ) {
    return this.users.updateProfile(user.id, body);
  }

  @Delete('me')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Permanently delete the current account (customer or provider)' })
  @ApiBody({ type: DeleteAccountDto })
  deleteMe(@CurrentUser() user: AuthenticatedUser, @Body() _dto: DeleteAccountDto) {
    return this.users.deleteAccount(user.id, user.type);
  }

  @Post('push-tokens')
  @ApiOperation({ summary: 'Register a push notification token' })
  savePushToken(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { token: string; platform: 'ios' | 'android' | 'web' },
  ) {
    return this.users.savePushToken(user.id, body.token, body.platform);
  }

  @Delete('push-tokens/:token')
  @ApiOperation({ summary: 'Remove a push notification token' })
  removePushToken(@Param('token') token: string) {
    return this.users.removePushToken(token);
  }

  @Get('notification-preferences')
  @ApiOperation({ summary: 'Get current account notification preferences' })
  getNotificationPreferences(@CurrentUser() user: AuthenticatedUser) {
    return this.users.getNotificationPreferences(user.id, user.type === 'provider' ? 'provider' : 'user');
  }

  @Put('notification-preferences')
  @ApiOperation({ summary: 'Update current account notification preferences' })
  updateNotificationPreferences(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { bookingUpdates?: boolean; bookingMessages?: boolean; paymentAlerts?: boolean; accountAlerts?: boolean },
  ) {
    return this.users.updateNotificationPreferences(user.id, user.type === 'provider' ? 'provider' : 'user', body);
  }
}
