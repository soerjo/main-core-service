import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../prisma/prisma.service.js';
import { UsersRepository } from './users.repository.js';
import type { CreateUserDto } from './dto/create-user.dto.js';
import type { UpdateUserDto } from './dto/update-user.dto.js';
import type { UpdateProfileDto } from './dto/update-profile.dto.js';
import type { AuthUser } from '../../common/interfaces/auth-user.interface.js';

interface UserWithRoles {
  id: string;
  email: string;
  password: string;
  firstName: string | null;
  lastName: string | null;
  avatarUrl: string | null;
  phone: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  userRoles?: Array<{
    organization: {
      id: string;
      name: string;
      slug: string;
      logoUrl: string | null;
      isActive: boolean;
      applicationId: string | null;
    };
    role: { id: string; name: string; displayName: string };
  }>;
}

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private usersRepository: UsersRepository,
    private prisma: PrismaService,
  ) {}

  async findAll(
    page = 1,
    limit = 20,
    organizationId?: string,
    applicationId?: string,
  ) {
    const skip = (page - 1) * limit;
    const { users, total } = await this.usersRepository.findAll({
      skip,
      take: limit,
      organizationId,
      applicationId,
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

  async findById(id: string) {
    const user = await this.usersRepository.findById(id);
    const {
      password: _password,
      userRoles,
      ...safeUser
    } = user as unknown as UserWithRoles;

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
    return this.usersRepository.update(id, dto as { [key: string]: unknown });
  }

  async create(dto: CreateUserDto, adminUser?: AuthUser) {
    const existingUser = await this.usersRepository.findByEmail(dto.email);
    if (existingUser) {
      throw new BadRequestException('Email already in use');
    }

    const hashedPassword = await bcrypt.hash(dto.password, 10);

    const organizationId = dto.organizationId ?? adminUser?.organizationId;

    const result = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: dto.email,
          password: hashedPassword,
          firstName: dto.firstName ?? null,
          lastName: dto.lastName ?? null,
          phone: dto.phone ?? null,
        },
      });

      if (organizationId) {
        const org = await tx.organization.findUnique({
          where: { id: organizationId },
        });
        if (!org) {
          throw new BadRequestException(
            `Organization ${organizationId} not found`,
          );
        }

        const lowestRole = await this.findLowestRole(tx, org.applicationId);

        if (lowestRole) {
          await tx.userRole.create({
            data: {
              userId: user.id,
              roleId: lowestRole.id,
              organizationId: org.id,
            },
          });
        } else {
          this.logger.warn(
            `No roles found for applicationId=${org.applicationId}. User created without role assignment.`,
          );
        }
      }

      return user;
    });

    const { password: _password, ...safeResult } = result;

    // TODO: audit.log - postponed (see AGENTS.md)

    return safeResult;
  }

  async update(id: string, dto: UpdateUserDto) {
    return this.usersRepository.update(id, dto as { [key: string]: unknown });
  }

  async updateStatus(id: string, isActive: boolean) {
    return this.usersRepository.updateStatus(id, isActive);
  }

  async remove(id: string) {
    const result = await this.usersRepository.delete(id);

    // TODO: audit.log - postponed (see AGENTS.md)

    return result;
  }

  private async findLowestRole(
    tx: Parameters<Parameters<typeof this.prisma.$transaction>[0]>[0],
    applicationId: string | null,
  ) {
    const roles = await tx.role.findMany({
      where: {
        OR: [{ applicationId }, { applicationId: null }],
      },
      include: {
        _count: { select: { rolePermissions: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    if (roles.length === 0) return null;

    const minPermissionCount = Math.min(
      ...roles.map((r) => r._count.rolePermissions),
    );

    return roles.find((r) => r._count.rolePermissions === minPermissionCount)!;
  }
}
