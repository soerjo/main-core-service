import { Cron } from '@nestjs/schedule';
import {
  Injectable,
  BadRequestException,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import * as bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../../prisma/prisma.service.js';
import { UsersRepository } from '../users/users.repository.js';
import { ApplicationsService } from '../applications/applications.service.js';
import type { AuthUser } from '../../common/interfaces/auth-user.interface.js';
import type { User } from '@prisma/client';
import type { RegisterDto } from './dto/register.dto.js';
import type { ClientCredentialsDto } from './dto/client-credentials.dto.js';
import type { SwitchOrganizationDto } from './dto/switch-organization.dto.js';

interface UserClaims {
  roles: string[];
  permissions: string[];
}

interface TokenInput {
  sub: string;
  email: string;
  organizationId: string;
  applicationId?: string;
  roles: string[];
  permissions: string[];
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private failedAttempts = new Map<
    string,
    { count: number; lockedUntil: number }
  >();

  constructor(
    private usersRepository: UsersRepository,
    private jwtService: JwtService,
    private configService: ConfigService,
    private prisma: PrismaService,
    private applicationsService: ApplicationsService,
    private eventEmitter: EventEmitter2,
  ) {}

  async validateUser(
    email: string,
    password: string,
  ): Promise<AuthUser | null> {
    const user = await this.usersRepository.findByEmail(email);
    if (!user) return null;

    if (!user.isActive) return null;

    const lockInfo = this.failedAttempts.get(email);
    if (lockInfo && lockInfo.lockedUntil > Date.now()) {
      throw new UnauthorizedException(
        'Account temporarily locked. Try again later.',
      );
    }

    if (!(await bcrypt.compare(password, user.password))) {
      const current = this.failedAttempts.get(email) ?? {
        count: 0,
        lockedUntil: 0,
      };
      current.count += 1;
      if (current.count >= 5) {
        current.lockedUntil = Date.now() + 15 * 60 * 1000;
        current.count = 0;
      }
      this.failedAttempts.set(email, current);
      return null;
    }

    this.failedAttempts.delete(email);
    return this.buildAuthUser(user);
  }

  async validateUserById(id: string): Promise<AuthUser | null> {
    const user = await this.usersRepository.findById(id);
    if (!user || !user.isActive) return null;
    return this.buildAuthUser(user);
  }

  async register(dto: RegisterDto, _ipAddress?: string, _userAgent?: string) {
    const existingUser = await this.usersRepository.findByEmail(dto.email);
    if (existingUser) {
      throw new BadRequestException('Email already in use');
    }

    if (dto.applicationId) {
      const app = await this.prisma.application.findUnique({
        where: { id: dto.applicationId },
      });
      if (!app || !app.isActive) {
        throw new BadRequestException('Invalid or inactive application');
      }
    }

    const hashedPassword = await bcrypt.hash(dto.password, 10);

    const result = await this.prisma.$transaction(async (tx) => {
      const systemAdminRole = await tx.role.findFirst({
        where: { name: 'org_admin', applicationId: null },
      });

      const organization = await tx.organization.create({
        data: {
          name: `Organization of ${dto.firstName ?? dto.email}`,
          slug: `org-${uuidv4().slice(0, 8)}`,
          applicationId: dto.applicationId ?? null,
        },
      });

      const user = await tx.user.create({
        data: {
          email: dto.email,
          password: hashedPassword,
          firstName: dto.firstName ?? null,
          lastName: dto.lastName ?? null,
        },
      });

      if (systemAdminRole) {
        await tx.userRole.create({
          data: {
            userId: user.id,
            roleId: systemAdminRole.id,
            organizationId: organization.id,
          },
        });
      }

      return { user, organization };
    });

    const applicationId = result.organization.applicationId;
    const claims = await this.resolveUserClaims(
      result.user.id,
      result.organization.id,
      applicationId ?? undefined,
    );

    const tokens = this.generateTokens({
      sub: result.user.id,
      email: result.user.email,
      organizationId: result.organization.id,
      applicationId: applicationId ?? undefined,
      ...claims,
    });

    await this.storeRefreshToken(
      result.user.id,
      tokens.refreshToken,
      result.organization.id,
      applicationId ?? undefined,
    );

    // TODO: audit.log - postponed (see AGENTS.md)

    this.eventEmitter.emit('user.registered', {
      userId: result.user.id,
      email: result.user.email,
      firstName: result.user.firstName,
    });

    const { password: _password, ...userSafe } = result.user;
    return {
      ...tokens,
      user: userSafe,
      organization: result.organization,
    };
  }

  async login(authUser: AuthUser, applicationId?: string) {
    let resolvedOrgId = authUser.organizationId;
    let resolvedAppId = authUser.applicationId;

    if (applicationId) {
      const userOrgInApp = await this.prisma.userRole.findFirst({
        where: {
          userId: authUser.sub,
          organization: { applicationId },
        },
        include: {
          organization: { select: { id: true, applicationId: true } },
        },
      });

      if (!userOrgInApp) {
        throw new BadRequestException(
          'You do not have an organization in this application',
        );
      }

      resolvedOrgId = userOrgInApp.organization.id;
      resolvedAppId = userOrgInApp.organization.applicationId ?? undefined;
    }

    const claims = await this.resolveUserClaims(
      authUser.sub,
      resolvedOrgId,
      resolvedAppId,
    );

    const tokens = this.generateTokens({
      sub: authUser.sub,
      email: authUser.email,
      organizationId: resolvedOrgId,
      applicationId: resolvedAppId,
      ...claims,
    });

    await this.storeRefreshToken(
      authUser.sub,
      tokens.refreshToken,
      resolvedOrgId,
      resolvedAppId,
    );

    // TODO: audit.log - postponed (see AGENTS.md)

    return tokens;
  }

  async refreshTokens(refreshToken: string) {
    const stored = await this.prisma.refreshToken.findUnique({
      where: { token: refreshToken },
    });

    if (!stored) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (stored.isUsed || stored.expiresAt < new Date()) {
      const usedToken = await this.prisma.refreshToken.findFirst({
        where: { token: refreshToken, isUsed: true },
      });
      if (usedToken) {
        await this.prisma.refreshToken.deleteMany({
          where: { userId: stored.userId },
        });
        throw new UnauthorizedException(
          'Token reuse detected. All sessions terminated.',
        );
      }
      throw new UnauthorizedException('Refresh token expired');
    }

    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { isUsed: true },
    });

    const authUser = await this.validateUserById(stored.userId);
    if (!authUser) {
      throw new UnauthorizedException('User no longer exists or is inactive');
    }

    const organizationId = stored.organizationId ?? authUser.organizationId;
    const applicationId = stored.applicationId ?? authUser.applicationId;

    const claims = await this.resolveUserClaims(
      authUser.sub,
      organizationId,
      applicationId,
    );

    const tokens = this.generateTokens({
      sub: authUser.sub,
      email: authUser.email,
      organizationId,
      applicationId,
      ...claims,
    });

    await this.storeRefreshToken(
      authUser.sub,
      tokens.refreshToken,
      organizationId,
      applicationId,
    );

    return tokens;
  }

  async logout(userId: string, refreshToken?: string) {
    if (refreshToken) {
      await this.prisma.refreshToken.deleteMany({
        where: { userId, token: refreshToken },
      });
    } else {
      await this.prisma.refreshToken.deleteMany({ where: { userId } });
    }
    return { message: 'Logged out successfully' };
  }

  async clientCredentials(dto: ClientCredentialsDto) {
    const app = await this.applicationsService.validateClientCredentials(
      dto.clientId,
      dto.clientSecret,
    );
    if (!app) {
      throw new UnauthorizedException('Invalid client credentials');
    }

    const permissions = await this.prisma.permission.findMany({
      where: { applicationId: app.id },
      select: { name: true },
    });

    const payload = {
      sub: app.name,
      type: 'service' as const,
      applicationId: app.id,
      permissions: permissions.map((p) => p.name),
    };

    const accessToken = this.jwtService.sign(payload);

    // TODO: audit.log - postponed (see AGENTS.md)

    return {
      accessToken,
      tokenType: 'Bearer',
      expiresIn: parseInt(
        this.configService.get<string>('JWT_ACCESS_EXPIRATION') ?? '900',
        10,
      ),
    };
  }

  async switchOrganization(userId: string, dto: SwitchOrganizationDto) {
    const membership = await this.prisma.userRole.findFirst({
      where: { userId, organizationId: dto.organizationId },
    });

    if (!membership) {
      throw new BadRequestException(
        'You are not a member of this organization',
      );
    }

    const organization = await this.prisma.organization.findUnique({
      where: { id: dto.organizationId },
    });

    if (!organization) {
      throw new BadRequestException('Organization not found');
    }

    const authUser = await this.validateUserById(userId);
    if (!authUser) {
      throw new UnauthorizedException('User not found or inactive');
    }

    const applicationId = organization.applicationId ?? undefined;
    const claims = await this.resolveUserClaims(
      userId,
      dto.organizationId,
      applicationId,
    );

    const tokens = this.generateTokens({
      sub: userId,
      email: authUser.email,
      organizationId: dto.organizationId,
      applicationId,
      ...claims,
    });

    await this.storeRefreshToken(
      userId,
      tokens.refreshToken,
      dto.organizationId,
      applicationId,
    );

    return tokens;
  }

  async setPassword(userId: string, newPassword: string) {
    const user = await this.usersRepository.findById(userId);
    if (user.password && user.password.length > 0) {
      throw new BadRequestException(
        'Password already set. Use change password instead.',
      );
    }
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await this.usersRepository.updatePassword(userId, hashedPassword);

    // TODO: audit.log - postponed (see AGENTS.md)

    return { message: 'Password set successfully' };
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ) {
    const user = await this.usersRepository.findById(userId);
    if (!user.password || user.password.length === 0) {
      throw new BadRequestException(
        'No password set. Use set password instead.',
      );
    }
    const isValid = await bcrypt.compare(currentPassword, user.password);
    if (!isValid) {
      throw new UnauthorizedException('Current password is incorrect');
    }
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await this.usersRepository.updatePassword(userId, hashedPassword);

    // TODO: audit.log - postponed (see AGENTS.md)

    return { message: 'Password changed successfully' };
  }

  async forgotPassword(email: string) {
    const user = await this.usersRepository.findByEmail(email);
    if (!user) {
      return {
        message: 'If the email exists, a reset link will be sent',
      };
    }

    const resetToken = uuidv4();
    const hashedToken = await bcrypt.hash(resetToken, 10);
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

    await this.prisma.passwordReset.create({
      data: {
        userId: user.id,
        token: hashedToken,
        expiresAt,
      },
    });

    const frontendUrl =
      this.configService.get<string>('FRONTEND_URL') ?? 'http://localhost:5173';
    const resetUrl = `${frontendUrl}/reset-password?token=${encodeURIComponent(resetToken)}&email=${encodeURIComponent(email)}`;

    this.eventEmitter.emit('user.forgot_password', {
      to: email,
      resetUrl,
      firstName: user.firstName,
    });

    // TODO: audit.log - postponed (see AGENTS.md)

    return {
      message: 'If the email exists, a reset link will be sent',
    };
  }

  async resetPassword(token: string, newPassword: string, email?: string) {
    const user = email ? await this.usersRepository.findByEmail(email) : null;
    if (!user) {
      throw new UnauthorizedException('Invalid reset token');
    }

    const recentResets = await this.prisma.passwordReset.findMany({
      where: {
        userId: user.id,
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    let validReset: (typeof recentResets)[number] | null = null;
    for (const reset of recentResets) {
      if (await bcrypt.compare(token, reset.token)) {
        validReset = reset;
        break;
      }
    }

    if (!validReset) {
      throw new UnauthorizedException('Invalid or expired reset token');
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await this.prisma.$transaction([
      this.prisma.passwordReset.update({
        where: { id: validReset.id },
        data: { usedAt: new Date() },
      }),
      this.prisma.user.update({
        where: { id: user.id },
        data: { password: hashedPassword },
      }),
    ]);

    await this.prisma.refreshToken.deleteMany({
      where: { userId: user.id },
    });

    // TODO: audit.log - postponed (see AGENTS.md)

    return { message: 'Password reset successfully' };
  }

  async validateGoogleUser(
    email: string,
    _firstName: string,
    _lastName: string,
  ): Promise<AuthUser | null> {
    const user = await this.usersRepository.findByEmail(email);
    if (!user) return null;
    if (!user.isActive) return null;
    return this.buildAuthUser(user);
  }

  private generateTokens(input: TokenInput) {
    const payload = {
      sub: input.sub,
      email: input.email,
      type: 'user' as const,
      organizationId: input.organizationId,
      applicationId: input.applicationId,
      roles: input.roles,
      permissions: input.permissions,
    };

    const accessToken = this.jwtService.sign(payload);
    const refreshToken = uuidv4() + uuidv4();

    return { accessToken, refreshToken };
  }

  @Cron('0 0 * * *')
  async cleanupExpiredRefreshTokens() {
    const result = await this.prisma.refreshToken.deleteMany({
      where: {
        OR: [{ expiresAt: { lt: new Date() } }, { isUsed: true }],
      },
    });
    if (result.count > 0) {
      this.logger.log(`Cleaned up ${result.count} expired/used refresh tokens`);
    }
  }

  private async storeRefreshToken(
    userId: string,
    token: string,
    organizationId?: string,
    applicationId?: string,
  ) {
    const expirationSeconds = parseInt(
      this.configService.get<string>('JWT_REFRESH_EXPIRATION') ?? '604800',
      10,
    );

    await this.prisma.refreshToken.create({
      data: {
        userId,
        token,
        organizationId: organizationId ?? null,
        applicationId: applicationId ?? null,
        expiresAt: new Date(Date.now() + expirationSeconds * 1000),
      },
    });
  }

  private async resolveUserClaims(
    userId: string,
    organizationId: string,
    applicationId?: string,
  ): Promise<UserClaims> {
    const userRoles = await this.prisma.userRole.findMany({
      where: { userId, organizationId },
      include: {
        role: {
          include: {
            rolePermissions: {
              include: { permission: { select: { name: true } } },
            },
          },
        },
      },
    });

    const filteredRoles = applicationId
      ? userRoles.filter(
          (ur) =>
            ur.role.applicationId === null ||
            ur.role.applicationId === applicationId,
        )
      : userRoles;

    return {
      roles: filteredRoles.map((ur) => ur.role.name),
      permissions: [
        ...new Set(
          filteredRoles.flatMap((ur) =>
            ur.role.rolePermissions.map((rp) => rp.permission.name),
          ),
        ),
      ],
    };
  }

  private buildAuthUser(user: User): AuthUser {
    const userRoles = (user as unknown as Record<string, unknown>).userRoles as
      | {
          organizationId: string;
          role: { name: string };
          organization: { applicationId?: string | null };
        }[]
      | undefined;

    const firstOrg = userRoles?.[0];

    return {
      sub: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      avatarUrl: user.avatarUrl ?? null,
      phone: user.phone ?? null,
      isActive: user.isActive,
      organizationId: firstOrg?.organizationId ?? '',
      applicationId: firstOrg?.organization?.applicationId ?? undefined,
      roles: userRoles?.map((ur) => ur.role.name) ?? [],
    };
  }
}
