import {
  Controller,
  Post,
  Body,
  UseGuards,
  Get,
  HttpCode,
  HttpStatus,
  Res,
  Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service.js';
import { RegisterDto } from './dto/register.dto.js';
import { SetPasswordDto } from './dto/set-password.dto.js';
import { ChangePasswordDto } from './dto/change-password.dto.js';
import { ForgotPasswordDto } from './dto/forgot-password.dto.js';
import { ResetPasswordDto } from './dto/reset-password.dto.js';
import { RefreshTokenDto } from './dto/refresh-token.dto.js';
import { ClientCredentialsDto } from './dto/client-credentials.dto.js';
import { SwitchOrganizationDto } from './dto/switch-organization.dto.js';
import { LocalAuthGuard } from './local-auth.guard.js';
import { GoogleAuthGuard } from './google-auth.guard.js';
import { Public } from '../../common/decorators/public.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import type { AuthUser } from '../../common/interfaces/auth-user.interface.js';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Throttle({ default: { limit: 3, ttl: 60000 } })
  @Post('register')
  async register(@Body() dto: RegisterDto, @Req() req: Request) {
    return this.authService.register(dto, req.ip, req.headers['user-agent']);
  }

  @Public()
  @UseGuards(LocalAuthGuard)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Req() req: Request & { user: AuthUser }) {
    return this.authService.login(req.user, req.ip, req.headers['user-agent']);
  }

  @Public()
  @UseGuards(GoogleAuthGuard)
  @Get('google')
  googleAuth() {}

  @Public()
  @UseGuards(GoogleAuthGuard)
  @Get('google/callback')
  async googleAuthRedirect(
    @Req() req: Request & { user: AuthUser },
    @Res({ passthrough: true }) res: Response,
  ) {
    const tokens = await this.authService.login(
      req.user,
      req.ip,
      req.headers['user-agent'],
    );
    const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:5173';
    const redirectUrl = `${frontendUrl}/auth/google/callback?accessToken=${encodeURIComponent(tokens.accessToken)}&refreshToken=${encodeURIComponent(tokens.refreshToken)}`;
    res.redirect(redirectUrl);
  }

  @Get('verify-token')
  @HttpCode(HttpStatus.OK)
  verifyToken(@CurrentUser() user: AuthUser) {
    return { valid: true, user };
  }

  @Public()
  @Post('refresh-token')
  @HttpCode(HttpStatus.OK)
  refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refreshTokens(dto.refreshToken);
  }

  @Post('set-password')
  @HttpCode(HttpStatus.OK)
  setPassword(@CurrentUser('id') userId: string, @Body() dto: SetPasswordDto) {
    return this.authService.setPassword(userId, dto.newPassword);
  }

  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  changePassword(
    @CurrentUser('id') userId: string,
    @Body() dto: ChangePasswordDto,
  ) {
    return this.authService.changePassword(
      userId,
      dto.currentPassword,
      dto.newPassword,
    );
  }

  @Public()
  @Throttle({ default: { limit: 3, ttl: 60000 } })
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto.email);
  }

  @Public()
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(
      dto.token,
      dto.newPassword,
      dto.email,
    );
  }

  @Public()
  @Post('token')
  @HttpCode(HttpStatus.OK)
  clientCredentials(@Body() dto: ClientCredentialsDto) {
    return this.authService.clientCredentials(dto);
  }

  @Post('switch-organization')
  @HttpCode(HttpStatus.OK)
  switchOrganization(
    @CurrentUser('id') userId: string,
    @Body() dto: SwitchOrganizationDto,
  ) {
    return this.authService.switchOrganization(userId, dto);
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  logout(
    @CurrentUser('id') userId: string,
    @Body() body?: { refreshToken?: string },
  ) {
    return this.authService.logout(userId, body?.refreshToken);
  }
}
