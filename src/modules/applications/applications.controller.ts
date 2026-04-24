import { Controller, Get, Post, Patch, Param, Body } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { ApplicationsService } from './applications.service.js';
import { CreateApplicationDto } from './dto/create-application.dto.js';
import { UpdateApplicationDto } from './dto/update-application.dto.js';
import { Permissions } from '../../common/decorators/permissions.decorator.js';
import { ParseUUIDPipe } from '../../common/pipes/parse-uuid.pipe.js';

@ApiTags('Applications')
@ApiBearerAuth()
@Controller('applications')
export class ApplicationsController {
  constructor(private readonly applicationsService: ApplicationsService) {}

  @Get()
  @Permissions('applications:read')
  findAll() {
    return this.applicationsService.findAll();
  }

  @Get(':id')
  @Permissions('applications:read')
  findById(@Param('id', ParseUUIDPipe) id: string) {
    return this.applicationsService.findById(id);
  }

  @Post()
  @Permissions('applications:write')
  create(@Body() dto: CreateApplicationDto) {
    return this.applicationsService.create(dto);
  }

  @Patch(':id')
  @Permissions('applications:write')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateApplicationDto,
  ) {
    return this.applicationsService.update(id, dto);
  }

  @Patch(':id/status')
  @Permissions('applications:write')
  updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { isActive: boolean },
  ) {
    return this.applicationsService.updateStatus(id, body.isActive);
  }

  @Post(':id/regenerate-secret')
  @Permissions('applications:write')
  regenerateSecret(@Param('id', ParseUUIDPipe) id: string) {
    return this.applicationsService.regenerateSecret(id);
  }
}
