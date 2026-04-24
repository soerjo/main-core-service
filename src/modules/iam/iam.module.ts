import { Module } from '@nestjs/common';
import { RolesController } from './roles/roles.controller.js';
import { RolesService } from './roles/roles.service.js';
import { RolesRepository } from './roles/roles.repository.js';
import { PermissionsController } from './permissions/permissions.controller.js';
import { PermissionsService } from './permissions/permissions.service.js';
import { PermissionsRepository } from './permissions/permissions.repository.js';
import { AccessController } from './access/access.controller.js';
import { AccessService } from './access/access.service.js';

@Module({
  controllers: [RolesController, PermissionsController, AccessController],
  providers: [
    RolesService,
    RolesRepository,
    PermissionsService,
    PermissionsRepository,
    AccessService,
  ],
  exports: [AccessService, RolesService, PermissionsService],
})
export class IamModule {}
