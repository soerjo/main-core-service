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
import { UsersService } from './users.service.js';
import { CreateUserDto } from './dto/create-user.dto.js';
import { UpdateUserDto } from './dto/update-user.dto.js';
import { UpdateProfileDto } from './dto/update-profile.dto.js';
import { UpdateStatusDto } from './dto/update-status.dto.js';
import { GetUserDto } from './dto/get-user.dto.js';
import { Permissions } from '../../common/decorators/permissions.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { ParseUUIDPipe } from '../../common/pipes/parse-uuid.pipe.js';
import type { AuthUser } from '../../common/interfaces/auth-user.interface.js';

@ApiTags('Users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  getProfile(@CurrentUser('sub') userId: string) {
    return this.usersService.getProfile(userId);
  }

  @Patch('me')
  updateProfile(
    @CurrentUser('sub') userId: string,
    @Body() dto: UpdateProfileDto,
  ) {
    return this.usersService.updateProfile(userId, dto);
  }

  @Get()
  @Permissions('users:read')
  findAll(@Query() dto: GetUserDto, @CurrentUser() adminUser: AuthUser) {
    return this.usersService.findAll(dto, adminUser);
  }

  @Get(':id')
  @Permissions('users:read')
  findById(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() adminUser: AuthUser,
  ) {
    return this.usersService.findById(id, adminUser);
  }

  @Post()
  @Permissions('users:write')
  create(@Body() dto: CreateUserDto, @CurrentUser() adminUser: AuthUser) {
    return this.usersService.create(dto, adminUser);
  }

  @Patch(':id')
  @Permissions('users:write')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto,
    @CurrentUser() adminUser: AuthUser,
  ) {
    return this.usersService.update(id, dto, adminUser);
  }

  @Patch(':id/status')
  @Permissions('users:write')
  updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateStatusDto,
    @CurrentUser() adminUser: AuthUser,
  ) {
    return this.usersService.updateStatus(id, dto.isActive, adminUser);
  }

  @Delete(':id')
  @Permissions('users:delete')
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() adminUser: AuthUser,
  ) {
    return this.usersService.remove(id, adminUser);
  }
}
