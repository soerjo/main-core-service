import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';

@Injectable()
export class OrganizationsRepository {
  constructor(private prisma: PrismaService) {}

  async findAll() {
    return this.prisma.organization.findMany({});
  }

  async findBySlug(slug: string) {
    const organization = await this.prisma.organization.findUnique({
      where: { slug },
    });
    if (!organization) {
      throw new NotFoundException(`Organization with slug ${slug} not found`);
    }
    return organization;
  }

  async findById(id: string) {
    const organization = await this.prisma.organization.findUnique({
      where: { id },
    });
    if (!organization) {
      throw new NotFoundException(`Organization with id ${id} not found`);
    }
    return organization;
  }

  async create(data: {
    name: string;
    slug: string;
    description?: string;
    website?: string;
    logoUrl?: string;
  }) {
    return this.prisma.organization.create({
      data,
    });
  }

  async update(id: string, data: { [key: string]: unknown }) {
    await this.findById(id);
    return this.prisma.organization.update({
      where: { id },
      data,
    });
  }

  async remove(id: string) {
    await this.findById(id);
    return this.prisma.organization.delete({ where: { id } });
  }
}
