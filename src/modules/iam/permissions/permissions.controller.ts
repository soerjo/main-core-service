import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { PermissionsService } from './permissions.service.js';
import { CreatePermissionDto } from './dto/create-permission.dto.js';
import { Permissions } from '../../../common/decorators/permissions.decorator.js';
import { ParseUUIDPipe } from '../../../common/pipes/parse-uuid.pipe.js';

@ApiTags('Permissions')
@ApiBearerAuth()
@Controller('permissions')
export class PermissionsController {
  constructor(private readonly permissionsService: PermissionsService) {}

  @Get()
  @Permissions('permissions:read')
  findAll(
    @Query('applicationId') applicationId?: string,
    @Query('module') module?: string,
  ) {
    return this.permissionsService.findAll(applicationId, module);
  }

  @Get(':id')
  @Permissions('permissions:read')
  findById(@Param('id', ParseUUIDPipe) id: string) {
    return this.permissionsService.findById(id);
  }

  @Post()
  @Permissions('permissions:write')
  create(@Body() dto: CreatePermissionDto) {
    return this.permissionsService.create(dto);
  }

  @Delete(':id')
  @Permissions('permissions:delete')
  delete(@Param('id', ParseUUIDPipe) id: string) {
    return this.permissionsService.delete(id);
  }
}
