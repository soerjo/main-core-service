import { Module, Global } from '@nestjs/common';
import { EmailService } from './email/email.service.js';
import { WebsocketGateway } from './websocket/websocket.gateway.js';
import { NotificationsService } from './notifications.service.js';
import { NotificationsController } from './notifications.controller.js';

@Global()
@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService, EmailService, WebsocketGateway],
  exports: [NotificationsService, EmailService],
})
export class NotificationsModule {}
