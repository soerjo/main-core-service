import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { HealthCheckService, HealthCheck } from '@nestjs/terminus';
import { Public } from '../../common/decorators/public.decorator.js';
import { PrismaHealthIndicator } from './indicators/prisma.health.indicator.js';
import { MinioHealthIndicator } from './indicators/minio.health.indicator.js';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(
    private health: HealthCheckService,
    private prismaIndicator: PrismaHealthIndicator,
    private minioIndicator: MinioHealthIndicator,
  ) {}

  @Get()
  @Public()
  @HealthCheck()
  check() {
    return this.health.check([
      () => this.prismaIndicator.isHealthy('database'),
      () => this.minioIndicator.isHealthy('minio'),
    ]);
  }
}
