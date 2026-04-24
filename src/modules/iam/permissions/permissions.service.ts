import { Injectable, BadRequestException } from '@nestjs/common';
import { PermissionsRepository } from './permissions.repository.js';
import type { CreatePermissionDto } from './dto/create-permission.dto.js';

@Injectable()
export class PermissionsService {
  constructor(private permissionsRepository: PermissionsRepository) {}

  async findAll(applicationId?: string, module?: string) {
    return this.permissionsRepository.findAll(
      applicationId || module ? { applicationId, module } : undefined,
    );
  }

  async findById(id: string) {
    return this.permissionsRepository.findById(id);
  }

  async create(dto: CreatePermissionDto) {
    const existing = await this.permissionsRepository.findByName(dto.name);
    if (existing) {
      throw new BadRequestException(`Permission "${dto.name}" already exists`);
    }

    const permission = await this.permissionsRepository.create({
      name: dto.name,
      displayName: dto.displayName,
      module: dto.module,
      action: dto.action,
      description: dto.description,
      ...(dto.applicationId
        ? { application: { connect: { id: dto.applicationId } } }
        : {}),
    });

    // TODO: audit.log - postponed (see AGENTS.md)

    return permission;
  }

  async delete(id: string) {
    await this.permissionsRepository.findById(id);
    const deleted = await this.permissionsRepository.delete(id);

    // TODO: audit.log - postponed (see AGENTS.md)

    return deleted;
  }
}
