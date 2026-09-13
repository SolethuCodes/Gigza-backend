import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AppleTokenVerifier } from './apple-token.verifier';
import { TempFirstAdminController } from './TEMP_first_admin.controller'; // TEMP — delete after first Super Admin
import { JwtStrategy } from './strategies/jwt.strategy';
import { LocalStrategy } from './strategies/local.strategy';
import { GoogleStrategy } from './strategies/google.strategy';
import { FacebookStrategy } from './strategies/facebook.strategy';
import { JwtRefreshStrategy } from './strategies/jwt-refresh.strategy';
import { GoogleAuthGuard } from './guards/google-auth.guard';
import { FacebookAuthGuard } from './guards/facebook-auth.guard';
import { EmailModule } from '../../services/email/email.module';
import { SmsModule } from '../../services/sms/sms.module';
import { RedisModule } from '../../services/redis/redis.module';

@Module({
  imports: [
    PassportModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('auth.jwtSecret'),
        signOptions: { expiresIn: config.get<string>('auth.jwtExpiresIn') },
      }),
    }),
    EmailModule,
    SmsModule,
    RedisModule,
  ],
  controllers: [AuthController, TempFirstAdminController],
  providers: [
    AuthService,
    AppleTokenVerifier,
    JwtStrategy,
    JwtRefreshStrategy,
    LocalStrategy,
    GoogleAuthGuard,
    FacebookAuthGuard,
    {
      provide: GoogleStrategy,
      useFactory: (config: ConfigService) => {
        const clientId = config.get<string>('auth.googleClientId');
        const clientSecret = config.get<string>('auth.googleClientSecret');
        return clientId && clientSecret ? new GoogleStrategy(config) : null;
      },
      inject: [ConfigService],
    },
    {
      provide: FacebookStrategy,
      useFactory: (config: ConfigService) => {
        const appId = config.get<string>('auth.facebookAppId');
        const appSecret = config.get<string>('auth.facebookAppSecret');
        return appId && appSecret ? new FacebookStrategy(config) : null;
      },
      inject: [ConfigService],
    },
  ],
  exports: [AuthService],
})
export class AuthModule {}
