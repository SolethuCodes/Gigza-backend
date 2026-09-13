import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { AuthService } from '../auth.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    private readonly config: ConfigService,
    private readonly auth: AuthService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('auth.jwtSecret') ?? 'fallback-secret',
    });
  }

  async validate(payload: { sub: string; email: string; role: string; type?: 'user' | 'provider' | 'admin' }) {
    const type = payload.type ?? 'user';
    if (type === 'provider') {
      const account = await this.auth.validateProviderById(payload.sub);
      if (!account) throw new UnauthorizedException();
      return { id: payload.sub, email: payload.email, phone: account.phone, role: payload.role, type };
    }
    if (type === 'admin') {
      const account = await this.auth.validateAdminById(payload.sub);
      if (!account) throw new UnauthorizedException();
      const access = this.auth.resolveAdminAccess(account);
      return {
        id: payload.sub,
        email: payload.email,
        phone: account.phone,
        role: payload.role,
        type,
        permissions: access.permissions,
        isSuperAdmin: access.isSuperAdmin,
        mustChangePassword: access.mustChangePassword,
        roleName: access.roleName,
      };
    }
    const account = await this.auth.validateUserById(payload.sub);
    if (!account) throw new UnauthorizedException();
    return { id: payload.sub, email: payload.email, phone: account.phone, role: payload.role, type };
  }
}
