import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';

@Injectable()
export class GoogleAuthGuard extends AuthGuard('google') {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {
    super();
  }

  getAuthenticateOptions(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<Request>();
    const clientState = typeof request.query['state'] === 'string' ? request.query['state'] : undefined;
    const state = this.jwt.sign(
      { clientState },
      { secret: this.config.get<string>('auth.jwtSecret'), expiresIn: '5m' },
    );
    return { state };
  }
}
