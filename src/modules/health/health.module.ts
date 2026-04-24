import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from './health.controller.js';
import { PrismaHealthIndicator } from './indicators/prisma.health.indicator.js';
import { MinioHealthIndicator } from './indicators/minio.health.indicator.js';
import { StorageService } from '../storage/storage.service.js';

@Module({
  imports: [TerminusModule],
  controllers: [HealthController],
  providers: [PrismaHealthIndicator, MinioHealthIndicator, StorageService],
})
export class HealthModule {}
