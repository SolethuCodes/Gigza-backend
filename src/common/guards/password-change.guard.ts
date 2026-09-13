import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { AuthenticatedUser } from '../decorators/current-user.decorator';
import { Request } from 'express';

@Injectable()
export class PasswordChangeGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request & { user: AuthenticatedUser }>();
    const user = request.user;
    if (user?.type === 'admin' && user.mustChangePassword) {
      throw new ForbiddenException('Set a new password before continuing');
    }
    return true;
  }
}
