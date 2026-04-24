import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional, IsUUID } from 'class-validator';

export class CreatePermissionDto {
  @ApiProperty({ example: 'inventory:write' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ example: 'Create/Edit Inventory' })
  @IsString()
  @IsNotEmpty()
  displayName: string;

  @ApiProperty({ example: 'inventory' })
  @IsString()
  @IsNotEmpty()
  module: string;

  @ApiProperty({ example: 'write' })
  @IsString()
  @IsNotEmpty()
  action: string;

  @ApiPropertyOptional({ example: 'Create and edit inventory items' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ example: 'uuid-of-application' })
  @IsUUID()
  @IsOptional()
  applicationId?: string;
}
