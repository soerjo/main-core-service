import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { AuditRepository } from './audit.repository.js';

@Injectable()
export class AuditService {
  constructor(private auditRepository: AuditRepository) {}

  @OnEvent('audit.log')
  async handleAuditLog(data: {
    userId?: string;
    applicationId?: string;
    action: string;
    resource?: string;
    ipAddress?: string;
    userAgent?: string;
    metadata?: unknown;
    organizationId?: string;
  }) {
    await this.auditRepository.create(data);
  }

  async findAll(params: {
    page?: number;
    limit?: number;
    userId?: string;
    action?: string;
    organizationId?: string;
    startDate?: string;
    endDate?: string;
  }) {
    const page = params.page ?? 1;
    const limit = params.limit ?? 20;
    const skip = (page - 1) * limit;

    const { logs, total } = await this.auditRepository.findAll({
      skip,
      take: limit,
      userId: params.userId,
      action: params.action,
      organizationId: params.organizationId,
      startDate: params.startDate,
      endDate: params.endDate,
    });

    return {
      data: logs,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }
}
