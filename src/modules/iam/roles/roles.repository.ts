import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service.js';
import type { Prisma, Role } from '@prisma/client';

@Injectable()
export class RolesRepository {
  constructor(private prisma: PrismaService) {}

  async findAll(params?: { applicationId?: string }): Promise<Role[]> {
    return this.prisma.role.findMany({
      where: params?.applicationId
        ? { applicationId: params.applicationId }
        : undefined,
      include: { rolePermissions: { include: { permission: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findById(
    id: string,
  ): Promise<Role & { rolePermissions: { permission: { name: string } }[] }> {
    const role = await this.prisma.role.findUnique({
      where: { id },
      include: { rolePermissions: { include: { permission: true } } },
    });
    if (!role) {
      throw new NotFoundException(`Role with id ${id} not found`);
    }
    return role;
  }

  async findByName(
    name: string,
    applicationId?: string | null,
  ): Promise<Role | null> {
    return this.prisma.role.findFirst({
      where: { name, applicationId: applicationId ?? null },
    });
  }

  async create(data: Prisma.RoleCreateInput): Promise<Role> {
    return this.prisma.role.create({ data });
  }

  async update(id: string, data: { [key: string]: unknown }): Promise<Role> {
    return this.prisma.role.update({ where: { id }, data });
  }

  async delete(id: string): Promise<Role> {
    return this.prisma.role.delete({ where: { id } });
  }

  async assignPermissions(
    roleId: string,
    permissionIds: string[],
  ): Promise<void> {
    await this.prisma.$transaction(
      permissionIds.map((permissionId) =>
        this.prisma.rolePermission.upsert({
          where: { roleId_permissionId: { roleId, permissionId } },
          update: {},
          create: { roleId, permissionId },
        }),
      ),
    );
  }

  async removePermission(roleId: string, permissionId: string): Promise<void> {
    await this.prisma.rolePermission.deleteMany({
      where: { roleId, permissionId },
    });
  }

  async findRolesByUserAndOrg(userId: string, organizationId: string) {
    return this.prisma.role.findMany({
      where: {
        userRoles: {
          some: { userId, organizationId },
        },
      },
      include: { rolePermissions: { include: { permission: true } } },
    });
  }
}
