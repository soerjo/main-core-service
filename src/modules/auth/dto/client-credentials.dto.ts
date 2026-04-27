import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class ClientCredentialsDto {
  @ApiPropertyOptional({ example: 'client_credentials' })
  @IsString()
  @IsOptional()
  grantType?: string;

  @ApiProperty({ example: 'uuid-client-id' })
  @IsString()
  @IsNotEmpty()
  clientId!: string;

  @ApiProperty({ example: 'plain-text-secret' })
  @IsString()
  @IsNotEmpty()
  clientSecret!: string;
}
