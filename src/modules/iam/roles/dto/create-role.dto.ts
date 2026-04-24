import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional, IsUUID } from 'class-validator';

export class CreateRoleDto {
  @ApiProperty({ example: 'pharmacist' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ example: 'Pharmacist' })
  @IsString()
  @IsNotEmpty()
  displayName: string;

  @ApiPropertyOptional({ example: 'Handles pharmacy operations' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ example: 'uuid-of-application' })
  @IsUUID()
  @IsOptional()
  applicationId?: string;
}
