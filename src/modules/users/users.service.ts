import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { UsersRepository } from './users.repository.js';
import type { CreateUserDto } from './dto/create-user.dto.js';
import type { UpdateUserDto } from './dto/update-user.dto.js';
import type { UpdateProfileDto } from './dto/update-profile.dto.js';
import type { AuthUser } from '../../common/interfaces/auth-user.interface.js';
import { GetUserDto } from './dto/get-user.dto.js';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(private usersRepository: UsersRepository) {}

  async findAll(dto: GetUserDto, adminUser: AuthUser) {
    const isSystemAdmin = adminUser.roles?.includes('system_admin');

    const organizationId = isSystemAdmin
      ? dto.organizationId
      : adminUser.organizationId;

    const { page, limit, search } = dto;
    const applicationId = isSystemAdmin ? dto.applicationId : undefined;
    const skip = (page - 1) * limit;

    const { users, total } = await this.usersRepository.findAll({
      skip,
      take: limit,
      organizationId,
      applicationId,
      search,
    });

    return {
      data: users,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findById(id: string, adminUser?: AuthUser) {
    const user = await this.usersRepository.findById(id);

    if (adminUser && !adminUser.roles?.includes('system_admin')) {
      const isInSameOrg = user.userRoles?.some(
        (ur) => ur.organization.id === adminUser.organizationId,
      );
      if (!isInSameOrg) {
        throw new ForbiddenException(
          'You can only view users within your organization',
        );
      }
    }

    const { password: _password, userRoles, ...safeUser } = user;

    const organizations =
      userRoles?.map((ur) => ({
        organization: ur.organization,
        role: ur.role,
      })) ?? [];

    return { ...safeUser, organizations };
  }

  async getProfile(id: string) {
    return this.findById(id);
  }

  async updateProfile(id: string, dto: UpdateProfileDto) {
    await this.usersRepository.findById(id);
    return this.usersRepository.update(id, dto as { [key: string]: unknown });
  }

  async create(dto: CreateUserDto, adminUser?: AuthUser) {
    const existingUser = await this.usersRepository.findByEmailLean(dto.email);
    if (existingUser) {
      throw new BadRequestException('Email already in use');
    }

    const organizationId = this.resolveOrganizationId(
      dto.organizationId,
      adminUser,
    );

    let roleId: string | undefined;
    if (organizationId) {
      const org =
        await this.usersRepository.findOrganizationById(organizationId);
      if (!org) {
        throw new BadRequestException(
          `Organization ${organizationId} not found`,
        );
      }

      const roles = await this.usersRepository.findRolesWithPermissionCount(
        org.applicationId,
      );
      const lowest = this.findLowestRole(roles);
      if (lowest) {
        roleId = lowest.id;
      } else {
        this.logger.warn(
          `No roles found for applicationId=${org.applicationId}. User created without role assignment.`,
        );
      }
    }

    const hashedPassword = await bcrypt.hash(dto.password, 10);

    const result = await this.usersRepository.createWithMembership({
      email: dto.email,
      password: hashedPassword,
      firstName: dto.firstName ?? null,
      lastName: dto.lastName ?? null,
      phone: dto.phone ?? null,
      organizationId,
      roleId,
    });

    const { password: _password, ...safeResult } = result;

    // TODO: audit.log - postponed (see AGENTS.md)

    return safeResult;
  }

  async update(id: string, dto: UpdateUserDto, adminUser: AuthUser) {
    await this.validateSameOrganization(id, adminUser);
    return this.usersRepository.update(id, dto as { [key: string]: unknown });
  }

  async updateStatus(id: string, isActive: boolean, adminUser: AuthUser) {
    if (id === adminUser.sub) {
      throw new BadRequestException('You cannot change your own status');
    }

    await this.validateSameOrganization(id, adminUser);
    return this.usersRepository.updateStatus(id, isActive);
  }

  async remove(id: string, adminUser: AuthUser) {
    if (id === adminUser.sub) {
      throw new BadRequestException('You cannot delete your own account');
    }

    await this.validateSameOrganization(id, adminUser);

    const result = await this.usersRepository.softDelete(id);

    // TODO: audit.log - postponed (see AGENTS.md)

    return result;
  }

  private async validateSameOrganization(
    targetUserId: string,
    adminUser: AuthUser,
  ) {
    if (adminUser.roles?.includes('system_admin')) return;

    const targetUser = await this.usersRepository.findById(targetUserId);

    const isTargetSystemAdmin = targetUser.userRoles?.some(
      (ur) => ur.role.name === 'system_admin',
    );
    if (isTargetSystemAdmin) {
      throw new ForbiddenException('Cannot modify a system administrator');
    }

    const isInSameOrg = targetUser.userRoles?.some(
      (ur) => ur.organization.id === adminUser.organizationId,
    );
    if (!isInSameOrg) {
      throw new ForbiddenException(
        'You can only manage users within your organization',
      );
    }
  }

  private resolveOrganizationId(
    dtoOrgId: string | undefined,
    adminUser: AuthUser | undefined,
  ): string | undefined {
    const organizationId = dtoOrgId ?? adminUser?.organizationId;

    if (
      organizationId &&
      adminUser &&
      !adminUser.roles?.includes('system_admin')
    ) {
      if (organizationId !== adminUser.organizationId) {
        throw new ForbiddenException(
          'You can only create users within your organization',
        );
      }
    }

    return organizationId;
  }

  private findLowestRole(
    roles: Array<{ id: string; _count: { rolePermissions: number } }>,
  ) {
    if (roles.length === 0) return null;

    const minPermissionCount = Math.min(
      ...roles.map((r) => r._count.rolePermissions),
    );

    return roles.find((r) => r._count.rolePermissions === minPermissionCount)!;
  }
}
