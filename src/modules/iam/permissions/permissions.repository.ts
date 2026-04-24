import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service.js';
import type { Prisma, Permission } from '@prisma/client';

@Injectable()
export class PermissionsRepository {
  constructor(private prisma: PrismaService) {}

  async findAll(params?: {
    applicationId?: string;
    module?: string;
  }): Promise<Permission[]> {
    return this.prisma.permission.findMany({
      where: {
        ...(params?.applicationId
          ? { applicationId: params.applicationId }
          : {}),
        ...(params?.module ? { module: params.module } : {}),
      },
      orderBy: [{ module: 'asc' }, { action: 'asc' }],
    });
  }

  async findById(id: string): Promise<Permission> {
    const permission = await this.prisma.permission.findUnique({
      where: { id },
    });
    if (!permission) {
      throw new NotFoundException(`Permission with id ${id} not found`);
    }
    return permission;
  }

  async findByName(name: string): Promise<Permission | null> {
    return this.prisma.permission.findUnique({ where: { name } });
  }

  async create(data: Prisma.PermissionCreateInput): Promise<Permission> {
    return this.prisma.permission.create({ data });
  }

  async delete(id: string): Promise<Permission> {
    return this.prisma.permission.delete({ where: { id } });
  }
}
