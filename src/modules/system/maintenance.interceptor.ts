import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Request } from 'express';
import { Observable } from 'rxjs';
import { SystemService } from './system.service';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';

@Injectable()
export class MaintenanceInterceptor implements NestInterceptor {
  constructor(private readonly system: SystemService) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const request = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    const path = `${request.originalUrl ?? request.url ?? ''}`.toLowerCase();
    if (this.isExempt(path, request.user)) {
      return next.handle();
    }

    const enabled = await this.system.isMaintenanceEnabled();
    if (!enabled) return next.handle();

    const message = await this.system.getMaintenanceMessage();
    throw new ServiceUnavailableException({
      code: 'MAINTENANCE',
      message: message || 'The platform is temporarily unavailable for maintenance.',
    });
  }

  private isExempt(path: string, user?: AuthenticatedUser) {
    if (user?.type === 'admin') return true;
    return (
      path.includes('/health') ||
      path.includes('/public/app-config') ||
      path.includes('/public/client-errors') ||
      path.includes('/auth/admin') ||
      path.includes('/admin/') ||
      path.includes('/docs')
    );
  }
}
