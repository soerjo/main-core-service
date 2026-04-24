import { Injectable } from '@nestjs/common';
import {
  HealthIndicator,
  HealthIndicatorResult,
  HealthCheckError,
} from '@nestjs/terminus';
import { StorageService } from '../../storage/storage.service.js';

@Injectable()
export class MinioHealthIndicator extends HealthIndicator {
  constructor(private storageService: StorageService) {
    super();
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    try {
      const isHealthy = await this.storageService.isHealthy();
      if (isHealthy) {
        return this.getStatus(key, true);
      }
      throw new HealthCheckError(
        'MinIO check failed',
        this.getStatus(key, false),
      );
    } catch {
      throw new HealthCheckError(
        'MinIO check failed',
        this.getStatus(key, false),
      );
    }
  }
}
