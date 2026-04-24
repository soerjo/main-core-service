import { plainToInstance } from 'class-transformer';
import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsPort,
  IsString,
  validateSync,
} from 'class-validator';

enum Environment {
  Development = 'development',
  Production = 'production',
  Test = 'test',
}

class EnvironmentVariables {
  @IsEnum(Environment)
  NODE_ENV: Environment = Environment.Development;

  @IsPort()
  @IsOptional()
  PORT: string = '3000';

  @IsString()
  @IsNotEmpty()
  DATABASE_URL!: string;

  @IsString()
  @IsNotEmpty()
  JWT_PRIVATE_KEY!: string;

  @IsString()
  @IsNotEmpty()
  JWT_PUBLIC_KEY!: string;

  @IsString()
  @IsOptional()
  JWT_ACCESS_EXPIRATION: string = '900';

  @IsString()
  @IsOptional()
  JWT_REFRESH_EXPIRATION: string = '604800';

  @IsString()
  @IsOptional()
  GOOGLE_CLIENT_ID: string = '';

  @IsString()
  @IsOptional()
  GOOGLE_CLIENT_SECRET: string = '';

  @IsString()
  @IsOptional()
  GOOGLE_CALLBACK_URL: string =
    'http://localhost:3000/api/v1/auth/google/callback';

  @IsString()
  @IsOptional()
  SMTP_HOST: string = 'localhost';

  @IsPort()
  @IsOptional()
  SMTP_PORT: string = '587';

  @IsString()
  @IsOptional()
  SMTP_USER: string = '';

  @IsString()
  @IsOptional()
  SMTP_PASS: string = '';

  @IsString()
  @IsOptional()
  SMTP_FROM: string = 'noreply@example.com';

  @IsString()
  @IsOptional()
  APP_NAME: string = 'Main Core Service';

  @IsString()
  @IsOptional()
  FRONTEND_URL: string = 'http://localhost:5173';

  @IsString()
  @IsOptional()
  CORS_ORIGINS: string = 'http://localhost:5173';

  @IsString()
  @IsOptional()
  MINIO_ENDPOINT: string = 'localhost';

  @IsString()
  @IsOptional()
  MINIO_PORT: string = '9000';

  @IsString()
  @IsOptional()
  MINIO_ACCESS_KEY: string = 'minioadmin';

  @IsString()
  @IsOptional()
  MINIO_SECRET_KEY: string = 'minioadmin';

  @IsString()
  @IsOptional()
  MINIO_BUCKET: string = 'main-core';

  @IsString()
  @IsOptional()
  MINIO_USE_SSL: string = 'false';
}

export function validate(config: Record<string, unknown>) {
  const validated = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(validated, { skipMissingProperties: false });

  if (errors.length > 0) {
    throw new Error(errors.toString());
  }
  return validated;
}
