import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { join } from 'path';
import { readFile } from 'fs/promises';

interface SendMailOptions {
  to: string;
  subject: string;
  template: 'forgot-password';
  context: Record<string, string>;
}

@Injectable()
export class EmailService {
  private transporter: Transporter;
  private readonly logger = new Logger(EmailService.name);

  constructor(private configService: ConfigService) {
    const host = this.configService.get<string>('SMTP_HOST')!;
    const port = parseInt(this.configService.get<string>('SMTP_PORT')!, 10);
    const user = this.configService.get<string>('SMTP_USER')!;
    const pass = this.configService.get<string>('SMTP_PASS')!;

    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      ...(user ? { auth: { user, pass } } : {}),
    });
  }

  async sendMail(options: SendMailOptions) {
    const from = this.configService.get<string>('SMTP_FROM')!;

    try {
      const html = await this.renderTemplate(options.template, options.context);

      await this.transporter.sendMail({
        from,
        to: options.to,
        subject: options.subject,
        html,
      });

      this.logger.log(`Email sent to ${options.to}: ${options.subject}`);
    } catch (error) {
      this.logger.error(
        `Failed to send email to ${options.to}: ${error instanceof Error ? error.message : String(error)}`,
      );
      // throw error; // just for developemtn comment it!
    }
  }

  private async renderTemplate(
    template: string,
    context: Record<string, string>,
  ): Promise<string> {
    const templatesDir = join(__dirname, 'templates');
    const filePath = join(templatesDir, `${template}.html`);
    let html = await readFile(filePath, 'utf-8');

    for (const [key, value] of Object.entries(context)) {
      html = html.replaceAll(`{{${key}}}`, value);
    }

    return html;
  }
}
