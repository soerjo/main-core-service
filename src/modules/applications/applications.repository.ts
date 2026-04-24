import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { Application } from '@prisma/client';

@Injectable()
export class ApplicationsRepository {
  constructor(private prisma: PrismaService) {}

  async findAll(): Promise<Application[]> {
    return this.prisma.application.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

  async findById(id: string): Promise<Application> {
    const app = await this.prisma.application.findUnique({ where: { id } });
    if (!app) {
      throw new NotFoundException(`Application with id ${id} not found`);
    }
    return app;
  }

  async findByName(name: string): Promise<Application | null> {
    return this.prisma.application.findUnique({ where: { name } });
  }

  async findByClientId(clientId: string): Promise<Application | null> {
    return this.prisma.application.findUnique({ where: { clientId } });
  }

  async create(data: {
    name: string;
    displayName: string;
    description?: string;
    clientId: string;
    clientSecret: string;
    redirectUris?: string;
  }): Promise<Application> {
    return this.prisma.application.create({ data });
  }

  async update(
    id: string,
    data: { [key: string]: unknown },
  ): Promise<Application> {
    return this.prisma.application.update({ where: { id }, data });
  }
}
