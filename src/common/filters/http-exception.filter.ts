import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
  Injectable,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  constructor(private readonly prisma: PrismaService) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request & { user?: { id?: string } }>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const exceptionResponse =
      exception instanceof HttpException ? exception.getResponse() : null;

    const message =
      typeof exceptionResponse === 'object' && exceptionResponse !== null
        ? (exceptionResponse as Record<string, unknown>)['message'] ?? 'Internal server error'
        : exceptionResponse ?? 'Internal server error';

    if (status >= 500) {
      const text = Array.isArray(message) ? message.join(', ') : String(message);
      this.logger.error(
        `${request.method} ${request.url} — ${status}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
      const endpoint = `${request.method} ${request.url}`.slice(0, 500);
      void this.prisma.errorLog.create({
        data: {
          errorCode: HttpStatus[status] ?? 'UNKNOWN_ERROR',
          message: text.slice(0, 1000),
          stack: exception instanceof Error ? exception.stack?.slice(0, 4000) : undefined,
          context: 'http',
          userId: request.user?.id,
          endpoint,
          statusCode: status,
        },
      }).then(async (log) => {
        const recent = await this.prisma.systemAlert.findFirst({
          where: {
            type: 'HTTP_ERROR',
            isResolved: false,
            title: { contains: endpoint.slice(0, 80) },
            createdAt: { gte: new Date(Date.now() - 10 * 60 * 1000) },
          },
        });
        if (recent) return;
        await this.prisma.systemAlert.create({
          data: {
            type: 'HTTP_ERROR',
            severity: 'high',
            title: `Server error ${status} on ${endpoint.slice(0, 80)}`,
            description: text.slice(0, 500),
            metadata: { errorLogId: log.id, endpoint, statusCode: status } as never,
          },
        });
      }).catch(() => undefined);
    }

    response.status(status).json({
      success: false,
      error: {
        code: HttpStatus[status] ?? 'UNKNOWN_ERROR',
        message,
        path: request.url,
      },
      timestamp: new Date().toISOString(),
    });
  }
}
