import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { MatchingService } from './matching.service';

@Injectable()
export class MatchingScheduler {
  private readonly logger = new Logger(MatchingScheduler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly matching: MatchingService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async handleRadiusExpansion(): Promise<void> {
    this.logger.log('[MatchingScheduler] Legacy service-request matching is disabled');
  }
}
