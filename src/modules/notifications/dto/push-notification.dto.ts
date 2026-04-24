import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsBoolean,
  IsObject,
  IsNotEmpty,
} from 'class-validator';

export class PushNotificationDto {
  @ApiPropertyOptional({
    example: '550e8400-e29b-41d4-a716-446655440000',
    description: 'Push to a specific user (WebSocket room user:{userId})',
  })
  @IsString()
  @IsOptional()
  userId?: string;

  @ApiPropertyOptional({
    example: 'org-uuid-here',
    description:
      'Push to all users in an organization (WebSocket room org:{orgId})',
  })
  @IsString()
  @IsOptional()
  organizationId?: string;

  @ApiPropertyOptional({
    example: false,
    description: 'Push to ALL connected clients',
  })
  @IsBoolean()
  @IsOptional()
  broadcast?: boolean;

  @ApiProperty({
    example: 'order.created',
    description: 'Socket.IO event name',
  })
  @IsString()
  @IsNotEmpty()
  event: string;

  @ApiProperty({
    example: { orderId: '123', status: 'confirmed', total: 50000 },
    description: 'Arbitrary JSON payload to send with the event',
  })
  @IsObject()
  @IsNotEmpty()
  data: Record<string, unknown>;
}
