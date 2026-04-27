import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional, IsArray } from 'class-validator';

export class CreateApplicationDto {
  @ApiProperty({ example: 'pharmacy' })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiProperty({ example: 'Pharmacy App' })
  @IsString()
  @IsNotEmpty()
  displayName!: string;

  @ApiPropertyOptional({ example: 'Pharmacy management application' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ example: ['http://localhost:3000/callback'] })
  @IsArray()
  @IsOptional()
  redirectUris?: string[];
}
