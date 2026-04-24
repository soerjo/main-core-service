import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { AuthService } from '../auth.service.js';
import type { JwtUserPayload } from '../../../common/interfaces/jwt-payload.interface.js';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private configService: ConfigService,
    private authService: AuthService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService
        .get<string>('JWT_PUBLIC_KEY')!
        .replace(/\\n/g, '\n'),
      algorithms: ['ES256'],
    });
  }

  async validate(payload: JwtUserPayload) {
    if (payload.type === 'user') {
      const user = await this.authService.validateUserById(payload.sub);
      if (!user) {
        throw new UnauthorizedException();
      }
      return user;
    }
    return payload;
  }
}
