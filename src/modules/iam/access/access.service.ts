import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { RolesRepository } from '../roles/roles.repository.js';

interface CacheEntry {
  permissions: string[];
  expiresAt: number;
}

@Injectable()
export class AccessService {
  private cache = new Map<string, CacheEntry>();
  private readonly TTL = 5 * 60 * 1000;

  constructor(
    private rolesRepository: RolesRepository,
    private prisma: PrismaService,
  ) {}

  async getUserPermissions(
    userId: string,
    organizationId: string,
    roleNames: string[],
    applicationId?: string,
  ): Promise<string[]> {
    const cacheKey = `${userId}:${organizationId}:${applicationId ?? 'global'}:${roleNames.sort().join(',')}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.permissions;
    }

    const roles = await this.rolesRepository.findRolesByUserAndOrg(
      userId,
      organizationId,
      applicationId,
    );

    const permissions = [
      ...new Set(
        roles.flatMap((r) => r.rolePermissions.map((rp) => rp.permission.name)),
      ),
    ];

    this.cache.set(cacheKey, {
      permissions,
      expiresAt: Date.now() + this.TTL,
    });

    return permissions;
  }

  async hasPermission(
    userId: string,
    organizationId: string,
    roleNames: string[],
    requiredPermission: string,
    applicationId?: string,
  ): Promise<boolean> {
    const permissions = await this.getUserPermissions(
      userId,
      organizationId,
      roleNames,
      applicationId,
    );
    return permissions.includes(requiredPermission);
  }

  clearCache(
    userId?: string,
    organizationId?: string,
    applicationId?: string,
  ): void {
    if (userId && organizationId) {
      const prefix = applicationId
        ? `${userId}:${organizationId}:${applicationId}:`
        : `${userId}:${organizationId}:`;
      for (const key of this.cache.keys()) {
        if (key.startsWith(prefix)) {
          this.cache.delete(key);
        }
      }
    } else {
      this.cache.clear();
    }
  }

  async getUserOrganizations(userId: string, applicationId?: string) {
    const where: { userId: string; organization?: { applicationId?: string } } =
      {
        userId,
      };

    if (applicationId) {
      where.organization = { applicationId };
    }

    const userRoles = await this.prisma.userRole.findMany({
      where,
      include: {
        organization: true,
        role: true,
      },
    });

    const orgMap = new Map<
      string,
      {
        id: string;
        name: string;
        slug: string;
        applicationId: string | null;
        roles: string[];
      }
    >();
    for (const ur of userRoles) {
      const existing = orgMap.get(ur.organizationId);
      if (existing) {
        existing.roles.push(ur.role.name);
      } else {
        orgMap.set(ur.organizationId, {
          id: ur.organization.id,
          name: ur.organization.name,
          slug: ur.organization.slug,
          applicationId: ur.organization.applicationId,
          roles: [ur.role.name],
        });
      }
    }

    return [...orgMap.values()];
  }
}
