import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import { AuthenticatedUser } from '../decorators/current-user.decorator';
import { Request } from 'express';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required?.length) return true;

    const request = context.switchToHttp().getRequest<Request & { user: AuthenticatedUser }>();
    const user = request.user;
    if (!user) throw new ForbiddenException('Insufficient permissions');
    if (user.type !== 'admin') throw new ForbiddenException('Insufficient permissions');
    if (user.isSuperAdmin) return true;

    const granted = new Set(user.permissions ?? []);
    const allowed = required.some((permission) => granted.has(permission));
    if (!allowed) {
      throw new ForbiddenException('You do not have permission to perform this action');
    }
    return true;
  }
}
