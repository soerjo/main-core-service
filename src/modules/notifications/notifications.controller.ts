import { Controller, Get, Patch, Param } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';

@ApiTags('Notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  @Get()
  findAll() {
    return { data: [], message: 'Notifications endpoint' };
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
