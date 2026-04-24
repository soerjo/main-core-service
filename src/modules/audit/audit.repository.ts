import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { AuditLog, Prisma } from '@prisma/client';

@Injectable()
export class AuditRepository {
  constructor(private prisma: PrismaService) {}

  async create(data: {
    userId?: string;
    applicationId?: string;
    action: string;
    resource?: string;
    ipAddress?: string;
    userAgent?: string;
    metadata?: unknown;
    organizationId?: string;
  }): Promise<AuditLog> {
    return this.prisma.auditLog.create({
      data: {
        userId: data.userId,
        applicationId: data.applicationId,
        action: data.action,
        resource: data.resource,
        ipAddress: data.ipAddress,
        userAgent: data.userAgent,
        metadata: data.metadata as Prisma.InputJsonValue,
        organizationId: data.organizationId,
      },
    });
  }

  async findAll(params: {
    skip?: number;
    take?: number;
    userId?: string;
    action?: string;
    organizationId?: string;
    startDate?: string;
    endDate?: string;
  }) {
    const where: Prisma.AuditLogWhereInput = {};
    if (params.userId) where.userId = params.userId;
    if (params.action) where.action = { contains: params.action };
    if (params.organizationId) where.organizationId = params.organizationId;
    if (params.startDate || params.endDate) {
      where.createdAt = {};
      if (params.startDate) where.createdAt.gte = new Date(params.startDate);
      if (params.endDate) where.createdAt.lte = new Date(params.endDate);
    }

    const [logs, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        skip: params.skip,
        take: params.take,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return { logs, total };
  }
}
