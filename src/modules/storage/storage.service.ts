import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Minio from 'minio';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class StorageService {
  private minioClient: Minio.Client;
  private bucket: string;
  private readonly logger = new Logger(StorageService.name);

  constructor(private configService: ConfigService) {
    this.bucket = this.configService.get<string>('MINIO_BUCKET') ?? 'main-core';
    this.minioClient = new Minio.Client({
      endPoint: this.configService.get<string>('MINIO_ENDPOINT') ?? 'localhost',
      port: parseInt(
        this.configService.get<string>('MINIO_PORT') ?? '9000',
        10,
      ),
      useSSL: this.configService.get<string>('MINIO_USE_SSL') === 'true',
      accessKey:
        this.configService.get<string>('MINIO_ACCESS_KEY') ?? 'minioadmin',
      secretKey:
        this.configService.get<string>('MINIO_SECRET_KEY') ?? 'minioadmin',
    });

    void this.ensureBucket();
  }

  private async ensureBucket() {
    try {
      const exists = await this.minioClient.bucketExists(this.bucket);
      if (!exists) {
        await this.minioClient.makeBucket(this.bucket);
        this.logger.log(`Created bucket: ${this.bucket}`);
      }
    } catch (error) {
      this.logger.warn(
        `MinIO bucket check failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async upload(
    file: {
      buffer: Buffer;
      originalname: string;
      mimetype: string;
      size: number;
    },
    organizationId: string,
    module: string,
  ) {
    const ext = file.originalname.split('.').pop();
    const key = `${organizationId}/${module}/${uuidv4()}.${ext}`;

    await this.minioClient.putObject(this.bucket, key, file.buffer, file.size, {
      'Content-Type': file.mimetype,
    });

    return {
      key,
      size: file.size,
      mimeType: file.mimetype,
    };
  }

  async getPresignedUrl(key: string, expirySeconds = 3600) {
    return this.minioClient.presignedGetObject(this.bucket, key, expirySeconds);
  }

  async delete(key: string) {
    await this.minioClient.removeObject(this.bucket, key);
    return { deleted: true };
  }

  async isHealthy(): Promise<boolean> {
    try {
      await this.minioClient.bucketExists(this.bucket);
      return true;
    } catch {
      return false;
    }
  }
}
