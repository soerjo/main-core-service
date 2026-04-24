// @ts-nocheck
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...');

  const systemPermissions = [
    { name: 'users:read', displayName: 'Read Users', module: 'users', action: 'read' },
    { name: 'users:write', displayName: 'Write Users', module: 'users', action: 'write' },
    { name: 'users:delete', displayName: 'Delete Users', module: 'users', action: 'delete' },
    { name: 'roles:read', displayName: 'Read Roles', module: 'roles', action: 'read' },
    { name: 'roles:write', displayName: 'Write Roles', module: 'roles', action: 'write' },
    { name: 'roles:delete', displayName: 'Delete Roles', module: 'roles', action: 'delete' },
    { name: 'permissions:read', displayName: 'Read Permissions', module: 'permissions', action: 'read' },
    { name: 'permissions:write', displayName: 'Write Permissions', module: 'permissions', action: 'write' },
    { name: 'permissions:delete', displayName: 'Delete Permissions', module: 'permissions', action: 'delete' },
    { name: 'organizations:read', displayName: 'Read Organizations', module: 'organizations', action: 'read' },
    { name: 'organizations:write', displayName: 'Write Organizations', module: 'organizations', action: 'write' },
    { name: 'organizations:delete', displayName: 'Delete Organizations', module: 'organizations', action: 'delete' },
    { name: 'applications:read', displayName: 'Read Applications', module: 'applications', action: 'read' },
    { name: 'applications:write', displayName: 'Write Applications', module: 'applications', action: 'write' },
    { name: 'applications:delete', displayName: 'Delete Applications', module: 'applications', action: 'delete' },
    { name: 'audit:read', displayName: 'Read Audit Logs', module: 'audit', action: 'read' },
    { name: 'storage:delete', displayName: 'Delete Storage Files', module: 'storage', action: 'delete' },
  ];

  const createdPermissions = [];
  for (const perm of systemPermissions) {
    const created = await prisma.permission.upsert({
      where: { name: perm.name },
      update: {},
      create: {
        name: perm.name,
        displayName: perm.displayName,
        module: perm.module,
        action: perm.action,
      },
    });
    createdPermissions.push(created);
  }

  async function findOrCreateRole(name: string, displayName: string, description: string) {
    const existing = await prisma.role.findFirst({ where: { name, applicationId: null } });
    if (existing) return existing;
    return prisma.role.create({
      data: { name, displayName, description, isSystem: true },
    });
  }

  const systemAdminRole = await findOrCreateRole(
    'system_admin',
    'System Administrator',
    'Full access to all system resources',
  );

  const orgAdminRole = await findOrCreateRole(
    'org_admin',
    'Organization Administrator',
    'Manage organization, users, and roles',
  );

  await findOrCreateRole(
    'user',
    'User',
    'Basic user role',
  );

  for (const perm of createdPermissions) {
    await prisma.rolePermission.upsert({
      where: {
        roleId_permissionId: { roleId: systemAdminRole.id, permissionId: perm.id },
      },
      update: {},
      create: { roleId: systemAdminRole.id, permissionId: perm.id },
    });

    await prisma.rolePermission.upsert({
      where: {
        roleId_permissionId: { roleId: orgAdminRole.id, permissionId: perm.id },
      },
      update: {},
      create: { roleId: orgAdminRole.id, permissionId: perm.id },
    });
  }

  const existingSuperAdmin = await prisma.user.findUnique({
    where: { email: 'superadmin@maincore.dev' },
  });

  if (!existingSuperAdmin) {
    const org = await prisma.organization.create({
      data: {
        name: 'System Organization',
        slug: 'system-org',
      },
    });

    const hashedPassword = await bcrypt.hash('SuperAdmin123!', 10);
    const superAdmin = await prisma.user.create({
      data: {
        email: 'superadmin@maincore.dev',
        password: hashedPassword,
        firstName: 'Super',
        lastName: 'Admin',
      },
    });

    await prisma.userRole.create({
      data: {
        userId: superAdmin.id,
        roleId: systemAdminRole.id,
        organizationId: org.id,
      },
    });

    console.log('Super admin created: superadmin@maincore.dev / SuperAdmin123!');
  }

  console.log('Seeding completed.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
