import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-local';
import { ApplicationsService } from '../../applications/applications.service.js';

@Injectable()
export class ClientCredentialsStrategy extends PassportStrategy(
  Strategy,
  'client-credentials',
) {
  constructor(private applicationsService: ApplicationsService) {
    super({ usernameField: 'clientId', passwordField: 'clientSecret' });
  }

  async validate(clientId: string, clientSecret: string) {
    const app = await this.applicationsService.validateClientCredentials(
      clientId,
      clientSecret,
    );
    if (!app) {
      throw new UnauthorizedException('Invalid client credentials');
    }
    return {
      sub: app.name,
      type: 'service' as const,
      applicationId: app.id,
    };
  }
}
