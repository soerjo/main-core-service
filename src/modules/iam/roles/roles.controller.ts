import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { RolesService } from './roles.service.js';
import { CreateRoleDto } from './dto/create-role.dto.js';
import { UpdateRoleDto } from './dto/update-role.dto.js';
import { AssignPermissionsDto } from './dto/assign-permissions.dto.js';
import { Permissions } from '../../../common/decorators/permissions.decorator.js';
import { ParseUUIDPipe } from '../../../common/pipes/parse-uuid.pipe.js';

@ApiTags('Roles')
@ApiBearerAuth()
@Controller('roles')
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  @Get()
  @Permissions('roles:read')
  findAll(@Query('applicationId') applicationId?: string) {
    return this.rolesService.findAll(applicationId);
  }

  @Get(':id')
  @Permissions('roles:read')
  findById(@Param('id', ParseUUIDPipe) id: string) {
    return this.rolesService.findById(id);
  }

  @Post()
  @Permissions('roles:write')
  create(@Body() dto: CreateRoleDto) {
    return this.rolesService.create(dto);
  }

  @Patch(':id')
  @Permissions('roles:write')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateRoleDto) {
    return this.rolesService.update(id, dto);
  }

  @Delete(':id')
  @Permissions('roles:delete')
  delete(@Param('id', ParseUUIDPipe) id: string) {
    return this.rolesService.delete(id);
  }

  @Post(':id/permissions')
  @Permissions('roles:write')
  assignPermissions(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignPermissionsDto,
  ) {
    return this.rolesService.assignPermissions(id, dto);
  }

  @Delete(':id/permissions/:permissionId')
  @Permissions('roles:write')
  removePermission(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('permissionId', ParseUUIDPipe) permissionId: string,
  ) {
    return this.rolesService.removePermission(id, permissionId);
  }
}
