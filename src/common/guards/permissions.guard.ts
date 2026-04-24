import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator.js';
import type {
  JwtUserPayload,
  JwtServicePayload,
} from '../interfaces/jwt-payload.interface.js';

interface GuardRequest {
  user?: JwtUserPayload;
  service?: JwtServicePayload;
  userPermissions?: string[];
}

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredPermissions = this.reflector.getAllAndOverride<string[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!requiredPermissions || requiredPermissions.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<GuardRequest>();
    const jwtPayload = request.user;
    const servicePayload = request.service;

    if (servicePayload) {
      return requiredPermissions.every((p) =>
        servicePayload.permissions.includes(p),
      );
    }

    if (!jwtPayload || jwtPayload.type !== 'user') {
      throw new ForbiddenException('Insufficient permissions');
    }

    const userPermissions = request.userPermissions;
    if (!userPermissions) {
      throw new ForbiddenException('Insufficient permissions');
    }

    return requiredPermissions.every((p) => userPermissions.includes(p));
  }
}
