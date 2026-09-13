import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { AuthenticatedUser } from '../decorators/current-user.decorator';
import { Request } from 'express';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredRoles) return true;

    const request = context.switchToHttp().getRequest<Request & { user: AuthenticatedUser }>();
    const { user } = request;

    const normalizedRole = user.role?.toUpperCase();
    const normalizedRequiredRoles = requiredRoles.map((role) => role.toUpperCase());
    if (!normalizedRole || !normalizedRequiredRoles.includes(normalizedRole)) {
      throw new ForbiddenException('Insufficient permissions');
    }
    return true;
  }
}
