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
import { ApiTags, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { OrganizationsService } from './organizations.service.js';
import { CreateOrganizationDto } from './dto/create-organization.dto.js';
import { UpdateOrganizationDto } from './dto/update-organization.dto.js';
import { AddMemberDto } from './dto/add-member.dto.js';
import { Permissions } from '../../common/decorators/permissions.decorator.js';
import { Public } from '../../common/decorators/public.decorator.js';
import { ParseUUIDPipe } from '../../common/pipes/parse-uuid.pipe.js';

@ApiTags('Organizations')
@ApiBearerAuth()
@Controller('organizations')
export class OrganizationsController {
  constructor(private readonly organizationsService: OrganizationsService) {}

  @Get()
  @Public()
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'applicationId', required: false })
  findAll(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('applicationId') applicationId?: string,
  ) {
    return this.organizationsService.findAll(
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 20,
      applicationId,
    );
  }

  @Get(':id')
  @Public()
  findById(@Param('id', ParseUUIDPipe) id: string) {
    return this.organizationsService.findById(id);
  }

  @Get('slug/:slug')
  @Public()
  @ApiQuery({ name: 'applicationId', required: false })
  findBySlug(
    @Param('slug') slug: string,
    @Query('applicationId') applicationId?: string,
  ) {
    return this.organizationsService.findBySlug(slug, applicationId);
  }

  @Post()
  @Permissions('organizations:write')
  create(@Body() dto: CreateOrganizationDto) {
    return this.organizationsService.create(dto);
  }

  @Patch(':id')
  @Permissions('organizations:write')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateOrganizationDto,
  ) {
    return this.organizationsService.update(id, dto);
  }

  @Patch(':id/status')
  @Permissions('organizations:write')
  updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { isActive: boolean },
  ) {
    return this.organizationsService.updateStatus(id, body.isActive);
  }

  @Get(':id/members')
  @Permissions('organizations:read')
  getMembers(@Param('id', ParseUUIDPipe) id: string) {
    return this.organizationsService.getMembers(id);
  }

  @Post(':id/members')
  @Permissions('organizations:write')
  addMember(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AddMemberDto) {
    return this.organizationsService.addMember(id, dto);
  }

  @Patch(':id/members/:userId')
  @Permissions('organizations:write')
  updateMemberRole(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() body: { roleId: string },
  ) {
    return this.organizationsService.updateMemberRole(id, userId, body.roleId);
  }

  @Delete(':id/members/:userId')
  @Permissions('organizations:write')
  removeMember(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) userId: string,
  ) {
    return this.organizationsService.removeMember(id, userId);
  }
}
