import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-google-oauth20';
import { ConfigService } from '@nestjs/config';
import { AuthService } from '../auth.service.js';

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor(
    private authService: AuthService,
    configService: ConfigService,
  ) {
    super({
      clientID: configService.get<string>('GOOGLE_CLIENT_ID') || 'disabled',
      clientSecret:
        configService.get<string>('GOOGLE_CLIENT_SECRET') || 'disabled',
      callbackURL:
        configService.get<string>('GOOGLE_CALLBACK_URL') || 'disabled',
      scope: ['email', 'profile'],
    });
  }

  async validate(
    _accessToken: string,
    _refreshToken: string,
    profile: {
      emails: { value: string }[];
      name: { givenName: string; familyName: string };
    },
  ) {
    const email = profile.emails[0].value;
    const firstName = profile.name.givenName;
    const lastName = profile.name.familyName;
    return this.authService.validateGoogleUser(email, firstName, lastName);
  }
}
