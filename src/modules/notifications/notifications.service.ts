import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ConfigService } from '@nestjs/config';
import { EmailService } from './email/email.service.js';
import { WebsocketGateway } from './websocket/websocket.gateway.js';

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
      await this.emailService.sendMail({
        to: data.email,
        subject: 'Welcome to Main Core Service',
        template: 'welcome',
        context: {
          firstName: data.firstName ?? 'User',
          loginUrl,
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
      await this.emailService.sendMail({
        to: data.to,
        subject: 'Reset your password',
        template: 'forgot-password',
        context: {
          resetUrl: data.resetUrl,
        },
      });
    } catch (error) {
      this.logger.error(
        `Failed to send reset email: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
