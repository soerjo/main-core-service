import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { OrganizationsRepository } from './organizations.repository.js';
import type { CreateOrganizationDto } from './dto/create-organization.dto.js';
import type { UpdateOrganizationDto } from './dto/update-organization.dto.js';
import type { AddMemberDto } from './dto/add-member.dto.js';

@Injectable()
export class OrganizationsService {
  constructor(
    private organizationsRepository: OrganizationsRepository,
    private prisma: PrismaService,
  ) {}

  async findAll(page = 1, limit = 20, applicationId?: string) {
    const skip = (page - 1) * limit;
    const { organizations, total } = await this.organizationsRepository.findAll(
      {
        skip,
        take: limit,
        applicationId,
      },
    );
    return {
      data: organizations,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findById(id: string) {
    return this.organizationsRepository.findById(id);
  }

  async findBySlug(slug: string, applicationId?: string) {
    return this.organizationsRepository.findBySlug(slug, applicationId);
  }

  async create(dto: CreateOrganizationDto) {
    if (dto.applicationId) {
      const app = await this.prisma.application.findUnique({
        where: { id: dto.applicationId },
      });
      if (!app || !app.isActive) {
        throw new BadRequestException('Invalid or inactive application');
      }
    }

    const org = await this.organizationsRepository.create({
      name: dto.name,
      slug: dto.slug,
      applicationId: dto.applicationId,
    });

    // TODO: audit.log - postponed (see AGENTS.md)

    return org;
  }

  async update(id: string, dto: UpdateOrganizationDto) {
    return this.organizationsRepository.update(
      id,
      dto as { [key: string]: unknown },
    );
  }

  async updateStatus(id: string, isActive: boolean) {
    return this.organizationsRepository.updateStatus(id, isActive);
  }

  async getMembers(organizationId: string) {
    return this.organizationsRepository.getMembers(organizationId);
  }

  async addMember(organizationId: string, dto: AddMemberDto) {
    const org = await this.organizationsRepository.findById(organizationId);

    if (org.applicationId) {
      const role = await this.prisma.role.findUnique({
        where: { id: dto.roleId },
      });
      if (
        role &&
        role.applicationId !== null &&
        role.applicationId !== org.applicationId
      ) {
        throw new BadRequestException(
          'Role does not belong to the same application as this organization',
        );
      }
    }

    const member = await this.organizationsRepository.addMember({
      userId: dto.userId,
      roleId: dto.roleId,
      organizationId,
    });

    // TODO: audit.log - postponed (see AGENTS.md)

    return member;
  }

  async updateMemberRole(
    organizationId: string,
    userId: string,
    roleId: string,
  ) {
    const member = await this.organizationsRepository.updateMemberRole(
      userId,
      organizationId,
      roleId,
    );

    // TODO: audit.log - postponed (see AGENTS.md)

    return member;
  }

  async removeMember(organizationId: string, userId: string) {
    const result = await this.organizationsRepository.removeMember(
      userId,
      organizationId,
    );

    // TODO: audit.log - postponed (see AGENTS.md)

    return result;
  }
}
