import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, Profile } from 'passport-facebook';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class FacebookStrategy extends PassportStrategy(Strategy, 'facebook') {
  constructor(private readonly config: ConfigService) {
    super({
      clientID: config.get<string>('auth.facebookAppId') ?? '',
      clientSecret: config.get<string>('auth.facebookAppSecret') ?? '',
      callbackURL: config.get<string>('auth.facebookCallbackUrl'),
      scope: ['email'],
      profileFields: ['id', 'emails', 'name', 'photos'],
      graphAPIVersion: 'v21.0',
    });
  }

  validate(
    _accessToken: string,
    _refreshToken: string,
    profile: Profile,
    done: (error: Error | null, user?: object) => void,
  ) {
    const { id, name, emails, photos } = profile;
    const user = {
      provider: 'facebook',
      providerAccountId: id,
      email: emails?.[0]?.value ?? '',
      firstName: name?.givenName ?? '',
      lastName: name?.familyName ?? '',
      avatarUrl: photos?.[0]?.value,
    };
    done(null, user);
  }
}
