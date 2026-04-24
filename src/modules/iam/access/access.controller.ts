import { Controller, Get, Query, Req } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { AccessService } from './access.service.js';
import type { Request } from 'express';
import type { JwtUserPayload } from '../../../common/interfaces/jwt-payload.interface.js';

@ApiTags('IAM')
@ApiBearerAuth()
@Controller('iam')
export class AccessController {
  constructor(private readonly accessService: AccessService) {}

  @Get('check')
  async checkPermission(
    @Query('permission') permission: string,
    @Query('organizationId') organizationId: string | undefined,
    @Req() req: Request,
  ) {
    const user = req.user as JwtUserPayload;
    const orgId = organizationId ?? user.organizationId;
    const hasPermission = await this.accessService.hasPermission(
      user.sub,
      orgId,
      user.roles,
      permission,
    );
    return { permission, authorized: hasPermission };
  }

  @Get('my-permissions')
  async myPermissions(@Req() req: Request) {
    const user = req.user as JwtUserPayload;
    const permissions = await this.accessService.getUserPermissions(
      user.sub,
      user.organizationId,
      user.roles,
    );
    return { permissions };
  }

  @Get('my-organizations')
  async myOrganizations(@Req() req: Request) {
    const user = req.user as JwtUserPayload;
    const roles = await this.accessService.getUserOrganizations(user.sub);
    return roles;
  }
}
