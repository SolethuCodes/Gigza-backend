import { Controller, Get } from '@nestjs/common';
import { HealthCheck, HealthCheckService, HealthIndicatorResult, PrismaHealthIndicator } from '@nestjs/terminus';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../services/redis/redis.service';

@ApiTags('health')
@Controller({ path: 'health', version: '1' })
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly prismaHealth: PrismaHealthIndicator,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  @Public()
  @Get()
  @HealthCheck()
  @ApiOperation({ summary: 'System health check (database and Redis)' })
  check() {
    return this.health.check([
      () => this.prismaHealth.pingCheck('database', this.prisma),
      () => this.redisCheck(),
    ]);
  }

  private async redisCheck(): Promise<HealthIndicatorResult> {
    const started = Date.now();
    try {
      await this.redis.ping();
      return {
        redis: {
          status: 'up',
          latencyMs: Date.now() - started,
        },
      };
    } catch {
      return {
        redis: {
          status: 'down',
          latencyMs: Date.now() - started,
        },
      };
    }
  }
}
