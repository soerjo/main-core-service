import { Controller, Get, Patch, Param, Post, Body } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { NotificationsService } from './notifications.service.js';
import { PushNotificationDto } from './dto/push-notification.dto.js';

@ApiTags('Notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  findAll() {
    return { data: [], message: 'Notifications endpoint' };
  }

  @Post('push')
  @ApiOperation({
    summary: 'Push a real-time notification via WebSocket',
    description:
      'Service-to-service endpoint. Requires a valid JWT (user or service token). Sends a WebSocket event to a specific user, organization, or all connected clients.',
  })
  push(@Body() dto: PushNotificationDto) {
    return this.notificationsService.push(dto);
  }

  @Patch(':id/read')
  markAsRead(@Param('id') _id: string) {
    return { message: 'Notification marked as read' };
  }

  @Patch('read-all')
  markAllAsRead() {
    return { message: 'All notifications marked as read' };
  }
}
