import { Controller, Get, Query, Req } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { AccessService } from './access.service.js';
import type { Request } from 'express';
import type { JwtUserPayload } from '../../../common/interfaces/jwt-payload.interface.js';

@ApiTags('IAM')
@ApiBearerAuth()
@Controller('iam')
export class AccessController {
  constructor(private readonly accessService: AccessService) {}

  @Get('check')
  @ApiQuery({ name: 'permission', required: true })
  @ApiQuery({ name: 'organizationId', required: false })
  @ApiQuery({ name: 'applicationId', required: false })
  async checkPermission(
    @Query('permission') permission: string,
    @Query('organizationId') organizationId: string | undefined,
    @Query('applicationId') applicationId: string | undefined,
    @Req() req: Request,
  ) {
    const user = req.user as JwtUserPayload;
    const orgId = organizationId ?? user.organizationId;
    const appId = applicationId ?? user.applicationId;
    const hasPermission = await this.accessService.hasPermission(
      user.sub,
      orgId,
      user.roles,
      permission,
      appId,
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
      user.applicationId,
    );
    return { permissions };
  }

  @Get('my-organizations')
  @ApiQuery({ name: 'applicationId', required: false })
  async myOrganizations(
    @Query('applicationId') applicationId: string | undefined,
    @Req() req: Request,
  ) {
    const user = req.user as JwtUserPayload;
    const organizations = await this.accessService.getUserOrganizations(
      user.sub,
      applicationId,
    );
    return organizations;
  }
}
