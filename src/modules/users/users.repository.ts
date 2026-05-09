import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { Prisma, User } from '@prisma/client';

export type UserWithRoles = Prisma.UserGetPayload<{
  include: {
    userRoles: {
      include: {
        role: true;
        organization: true;
      };
    };
  };
}>;

const USER_PUBLIC_SELECT = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  avatarUrl: true,
  phone: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.UserSelect;

@Injectable()
export class UsersRepository {
  constructor(private prisma: PrismaService) {}

  async findAll(params: {
    skip?: number;
    take?: number;
    organizationId?: string;
    applicationId?: string;
    search?: string;
  }) {
    const where: Prisma.UserWhereInput = {};

    if (params.search) {
      where.OR = [
        { firstName: { contains: params.search, mode: 'insensitive' } },
        { lastName: { contains: params.search, mode: 'insensitive' } },
        { email: { contains: params.search, mode: 'insensitive' } },
      ];
    }

    if (params.organizationId) {
      where.userRoles = { some: { organizationId: params.organizationId } };
    }

    if (params.applicationId && !params.organizationId) {
      where.userRoles = {
        some: {
          organization: { applicationId: params.applicationId },
        },
      };
    }

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: USER_PUBLIC_SELECT,
        skip: params.skip,
        take: params.take,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.user.count({ where }),
    ]);

    return { users, total };
  }

  async findById(id: string): Promise<UserWithRoles> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: {
        userRoles: {
          include: {
            role: true,
            organization: true,
          },
        },
      },
    });
    if (!user) {
      throw new NotFoundException(`User with id ${id} not found`);
    }
    return user;
  }

  async findByEmail(email: string): Promise<UserWithRoles | null> {
    return this.prisma.user.findUnique({
      where: { email },
      include: {
        userRoles: {
          include: {
            role: true,
            organization: true,
          },
        },
      },
    });
  }

  async findByEmailLean(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { email } });
  }

  async findOrganizationById(id: string) {
    return this.prisma.organization.findUnique({ where: { id } });
  }

  async findRolesWithPermissionCount(applicationId: string | null) {
    return this.prisma.role.findMany({
      where: {
        OR: [{ applicationId }, { applicationId: null }],
      },
      include: {
        _count: { select: { rolePermissions: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async create(data: Prisma.UserCreateInput): Promise<User> {
    return this.prisma.user.create({ data });
  }

  async createWithMembership(params: {
    email: string;
    password: string;
    firstName: string | null;
    lastName: string | null;
    phone: string | null;
    organizationId?: string;
    roleId?: string;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: params.email,
          password: params.password,
          firstName: params.firstName,
          lastName: params.lastName,
          phone: params.phone,
        },
      });

      if (params.organizationId && params.roleId) {
        await tx.userRole.create({
          data: {
            userId: user.id,
            roleId: params.roleId,
            organizationId: params.organizationId,
          },
        });
      }

      return user;
    });
  }

  async update(id: string, data: { [key: string]: unknown }) {
    return this.prisma.user.update({
      where: { id },
      data,
      select: USER_PUBLIC_SELECT,
    });
  }

  async updatePassword(id: string, hashedPassword: string) {
    return this.prisma.user.update({
      where: { id },
      data: { password: hashedPassword },
    });
  }

  async updateStatus(id: string, isActive: boolean) {
    return this.prisma.user.update({
      where: { id },
      data: { isActive },
      select: {
        id: true,
        email: true,
        isActive: true,
      },
    });
  }

  async softDelete(id: string) {
    return this.prisma.user.update({
      where: { id },
      data: { isActive: false },
      select: USER_PUBLIC_SELECT,
    });
  }
}
