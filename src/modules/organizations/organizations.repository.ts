import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { Organization } from '@prisma/client';

@Injectable()
export class OrganizationsRepository {
  constructor(private prisma: PrismaService) {}

  async findAll(params?: {
    skip?: number;
    take?: number;
    applicationId?: string;
  }) {
    const where = params?.applicationId
      ? { applicationId: params.applicationId }
      : undefined;

    const [organizations, total] = await Promise.all([
      this.prisma.organization.findMany({
        where,
        skip: params?.skip,
        take: params?.take,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.organization.count({ where }),
    ]);
    return { organizations, total };
  }

  async findById(id: string): Promise<Organization> {
    const org = await this.prisma.organization.findUnique({ where: { id } });
    if (!org) {
      throw new NotFoundException(`Organization with id ${id} not found`);
    }
    return org;
  }

  async findBySlug(
    slug: string,
    applicationId?: string,
  ): Promise<Organization> {
    const org = await this.prisma.organization.findFirst({
      where: { slug, applicationId: applicationId ?? null },
    });
    if (!org) {
      throw new NotFoundException(`Organization with slug ${slug} not found`);
    }
    return org;
  }

  async create(data: {
    name: string;
    slug: string;
    logoUrl?: string;
    applicationId?: string;
  }): Promise<Organization> {
    return this.prisma.organization.create({ data });
  }

  async update(
    id: string,
    data: { [key: string]: unknown },
  ): Promise<Organization> {
    await this.findById(id);
    return this.prisma.organization.update({ where: { id }, data });
  }

  async updateStatus(id: string, isActive: boolean): Promise<Organization> {
    await this.findById(id);
    return this.prisma.organization.update({
      where: { id },
      data: { isActive },
    });
  }

  async getMembers(organizationId: string) {
    return this.prisma.userRole.findMany({
      where: { organizationId },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            avatarUrl: true,
          },
        },
        role: true,
      },
    });
  }

  async addMember(data: {
    userId: string;
    roleId: string;
    organizationId: string;
  }) {
    return this.prisma.userRole.create({ data });
  }

  async updateMemberRole(
    userId: string,
    organizationId: string,
    roleId: string,
  ) {
    const existing = await this.prisma.userRole.findFirst({
      where: { userId, organizationId },
    });
    if (!existing) {
      throw new NotFoundException('Member not found in organization');
    }
    return this.prisma.userRole.update({
      where: { id: existing.id },
      data: { roleId },
    });
  }

  async removeMember(userId: string, organizationId: string) {
    const existing = await this.prisma.userRole.findFirst({
      where: { userId, organizationId },
    });
    if (!existing) {
      throw new NotFoundException('Member not found in organization');
    }
    return this.prisma.userRole.delete({ where: { id: existing.id } });
  }
}
