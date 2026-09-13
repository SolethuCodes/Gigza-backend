import { NestFactory } from '@nestjs/core';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { IoAdapter } from '@nestjs/platform-socket.io';
import helmet from 'helmet';
import compression from 'compression';
import * as express from 'express';
import { join } from 'path';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { corsOptions } from './config/cors';

async function bootstrap() {
  // rawBody: true buffers the exact request bytes onto req.rawBody alongside the
  // normal parsed body — needed to verify webhook HMAC signatures (Sumsub's
  // legacy x-payload-digest over raw bytes, and Didit's X-Signature-V2 over a
  // re-canonicalized body derived from the raw JSON).
  const app = await NestFactory.create(AppModule, { bufferLogs: true, rawBody: true });

  const configService = app.get(ConfigService);
  const logger = app.get(WINSTON_MODULE_NEST_PROVIDER);
  app.useLogger(logger);

  // Azure App Service (and other reverse proxies) terminate TLS in front of Node.
  app.getHttpAdapter().getInstance().set('trust proxy', 1);

  // Security
  app.use('/api/v1/payments/stripe/webhook', express.raw({ type: 'application/json' }));
  app.use('/api/v1/payments/paystack/webhook', express.raw({ type: 'application/json' }));
  app.use('/api/v1/webhooks/flutterwave', express.raw({ type: 'application/json' }));
  app.use(helmet());
  app.use(compression());
  app.use('/uploads', express.static(join(process.cwd(), 'uploads')));

  app.enableCors(corsOptions());

  // Versioning
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.setGlobalPrefix('api');

  // Validation
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // Global filters & interceptors
  app.useGlobalFilters(app.get(HttpExceptionFilter));
  app.useGlobalInterceptors(
    new LoggingInterceptor(),
    new TransformInterceptor(),
  );

  // WebSockets adapter
  app.useWebSocketAdapter(new IoAdapter(app));

  // Swagger — dev only
  if (configService.get('NODE_ENV') !== 'production') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('E-RRANDS API')
      .setDescription('Any Service, Anytime — API Documentation')
      .setVersion('1.0')
      .addBearerAuth()
      .addTag('auth', 'Authentication & account management')
      .addTag('users', 'User profiles')
      .addTag('providers', 'Service provider management')
      .addTag('categories', 'Service categories')
      .addTag('bookings', 'Booking lifecycle management')
      .addTag('payments', 'Payment processing & invoices')
      .addTag('wallet', 'Provider wallet & withdrawals')
      .addTag('ratings', 'Ratings & reviews')
      .addTag('notifications', 'Push & in-app notifications')
      .addTag('disputes', 'Dispute management')
      .addTag('admin', 'Admin & manager operations')
      .addTag('support', 'Technical support & monitoring')
      .addTag('health', 'System health checks')
      .build();

    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api/docs', app, document);
  }

  const port = configService.get<number>('PORT', 4000);
  await app.listen(port, '0.0.0.0');
  logger.log(`🚀 E-RRANDS API running on http://0.0.0.0:${port}/api/v1`, 'Bootstrap');
  logger.log(`📖 Swagger docs: http://localhost:${port}/api/docs`, 'Bootstrap');
}

void bootstrap();
