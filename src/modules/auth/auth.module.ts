import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service.js';
import { AuthController } from './auth.controller.js';
import { LocalStrategy } from './strategies/local.strategy.js';
import { JwtStrategy } from './strategies/jwt.strategy.js';
import { ClientCredentialsStrategy } from './strategies/client-credentials.strategy.js';
import { UsersModule } from '../users/users.module.js';
import { ApplicationsModule } from '../applications/applications.module.js';
import { GoogleStrategy } from './strategies/google.strategy.js';

@Module({
  imports: [
    PassportModule,
    UsersModule,
    ApplicationsModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        privateKey: configService
          .get<string>('JWT_PRIVATE_KEY')!
          .replace(/\\n/g, '\n'),
        signOptions: {
          algorithm: 'ES256',
          expiresIn: parseInt(
            configService.get<string>('JWT_ACCESS_EXPIRATION') ?? '900',
            10,
          ),
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    LocalStrategy,
    JwtStrategy,
    ClientCredentialsStrategy,
    GoogleStrategy,
  ],
  exports: [AuthService],
})
export class AuthModule {}
