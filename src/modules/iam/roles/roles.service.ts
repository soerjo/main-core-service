import { Injectable, BadRequestException } from '@nestjs/common';
import { RolesRepository } from './roles.repository.js';
import type { CreateRoleDto } from './dto/create-role.dto.js';
import type { UpdateRoleDto } from './dto/update-role.dto.js';
import type { AssignPermissionsDto } from './dto/assign-permissions.dto.js';

@Injectable()
export class RolesService {
  constructor(
    private rolesRepository: RolesRepository,
  ) {}

  async findAll(applicationId?: string) {
    return this.rolesRepository.findAll(
      applicationId ? { applicationId } : undefined,
    );
  }

  async findById(id: string) {
    const role = await this.rolesRepository.findById(id);
    return {
      ...role,
      permissions: role.rolePermissions.map((rp) => rp.permission),
    };
  }

  async create(dto: CreateRoleDto) {
    const existing = await this.rolesRepository.findByName(
      dto.name,
      dto.applicationId ?? null,
    );
    if (existing) {
      throw new BadRequestException(`Role "${dto.name}" already exists`);
    }

    const role = await this.rolesRepository.create({
      name: dto.name,
      displayName: dto.displayName,
      description: dto.description,
      isSystem: false,
      ...(dto.applicationId
        ? { application: { connect: { id: dto.applicationId } } }
        : {}),
    });

    // TODO: audit.log - postponed (see AGENTS.md)

    return role;
  }

  async update(id: string, dto: UpdateRoleDto) {
    await this.rolesRepository.findById(id);
    const role = await this.rolesRepository.update(
      id,
      dto as { [key: string]: unknown },
    );

    // TODO: audit.log - postponed (see AGENTS.md)

    return role;
  }

  async delete(id: string) {
    const role = await this.rolesRepository.findById(id);
    if (role.isSystem) {
      throw new BadRequestException('Cannot delete system roles');
    }

    const deleted = await this.rolesRepository.delete(id);

    // TODO: audit.log - postponed (see AGENTS.md)

    return deleted;
  }

  async assignPermissions(id: string, dto: AssignPermissionsDto) {
    await this.rolesRepository.findById(id);
    await this.rolesRepository.assignPermissions(id, dto.permissionIds);

    // TODO: audit.log - postponed (see AGENTS.md)

    return this.findById(id);
  }

  async removePermission(id: string, permissionId: string) {
    await this.rolesRepository.findById(id);
    await this.rolesRepository.removePermission(id, permissionId);

    // TODO: audit.log - postponed (see AGENTS.md)

    return this.findById(id);
  }
}
