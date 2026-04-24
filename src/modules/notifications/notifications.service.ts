import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ConfigService } from '@nestjs/config';
import { EmailService } from './email/email.service.js';
import { WebsocketGateway } from './websocket/websocket.gateway.js';
import type { PushNotificationDto } from './dto/push-notification.dto.js';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private emailService: EmailService,
    private websocketGateway: WebsocketGateway,
    private configService: ConfigService,
  ) {}

  @OnEvent('user.registered')
  async handleUserRegistered(data: {
    userId: string;
    email: string;
    firstName: string | null;
  }) {
    try {
      const loginUrl = `${this.configService.get<string>('FRONTEND_URL') ?? 'http://localhost:5173'}/login`;
      const supportEmail = this.configService.get<string>('SMTP_FROM')!;
      await this.emailService.sendMail({
        to: data.email,
        subject: 'Welcome to Main Core Service',
        template: 'welcome',
        context: {
          firstName: data.firstName ?? 'User',
          loginUrl,
          supportEmail,
        },
      });
    } catch (error) {
      this.logger.error(
        `Failed to send welcome email: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    this.websocketGateway.sendToUser(data.userId, 'notification', {
      type: 'welcome',
      message: 'Welcome to Main Core Service!',
    });
  }

  @OnEvent('user.forgot_password')
  async handleForgotPassword(data: {
    to: string;
    resetUrl: string;
    firstName: string | null;
  }) {
    try {
      const supportEmail = this.configService.get<string>('SMTP_FROM')!;
      await this.emailService.sendMail({
        to: data.to,
        subject: 'Reset your password',
        template: 'forgot-password',
        context: {
          firstName: data.firstName ? ` ${data.firstName}` : '',
          resetUrl: data.resetUrl,
          supportEmail,
        },
      });
    } catch (error) {
      this.logger.error(
        `Failed to send reset email: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  push(dto: PushNotificationDto) {
    if (!dto.userId && !dto.organizationId && !dto.broadcast) {
      throw new BadRequestException(
        'Provide at least one target: userId, organizationId, or broadcast',
      );
    }

    if (dto.broadcast) {
      this.websocketGateway.broadcast(dto.event, dto.data);
      this.logger.log(`Broadcast event '${dto.event}'`);
      return { target: 'broadcast', event: dto.event };
    }

    if (dto.organizationId) {
      this.websocketGateway.sendToOrg(dto.organizationId, dto.event, dto.data);
      this.logger.log(
        `Push to org '${dto.organizationId}' event '${dto.event}'`,
      );
      return {
        target: 'organization',
        organizationId: dto.organizationId,
        event: dto.event,
      };
    }

    if (dto.userId) {
      this.websocketGateway.sendToUser(dto.userId, dto.event, dto.data);
      this.logger.log(`Push to user '${dto.userId}' event '${dto.event}'`);
      return { target: 'user', userId: dto.userId, event: dto.event };
    }

    return { target: 'none', event: dto.event };
  }
}
