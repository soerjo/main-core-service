# Plan: Application-Scoped Organizations (Approach A)

## Overview

Add `applicationId` to the `Organization` model so each org belongs to a specific app (Laundry, Pharmacy, Warehouse, Shop). This enables per-app RBAC where users logging into a specific app only see their orgs and permissions within that app.

## Design Decisions

- **`applicationId` on Organization**: Optional (nullable) — supports both app-scoped orgs and global orgs
- **Slug uniqueness**: `@@unique([slug, applicationId])` — same slug allowed across different apps
- **Registration**: Accepts optional `applicationId` — auto-created org belongs to that app
- **Login**: Accepts optional `applicationId` — resolves user's org within that app context
- **Refresh tokens**: Store `organizationId` + `applicationId` to maintain session context across refreshes

## User Flow Example

```
User A opens Laundry App → POST /auth/login { email, password, applicationId: "laundry-app-uuid" }
  → Gets JWT with applicationId, Laundry Serpong org, Laundry-specific permissions

User A switches org in Laundry App → POST /auth/switch-organization { organizationId: "laundry-bogor-uuid" }
  → Gets new JWT with Laundry Bogor org, different permissions within Laundry app
```

---

## Phase 1 — Schema & Migration

### 1.1 `prisma/schema.prisma`

**Organization model** — add `applicationId` and change slug constraint:
```prisma
model Organization {
  id             String   @id @default(uuid())
  name           String
  slug           String
  logoUrl        String?
  applicationId  String?
  isActive       Boolean  @default(true)
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  application    Application? @relation(fields: [applicationId], references: [id], onDelete: SetNull)
  userRoles      UserRole[]

  @@unique([slug, applicationId])
  @@map("organizations")
}
```

**Application model** — add organizations relation:
```prisma
organizations Organization[]
```

**RefreshToken model** — add context columns:
```prisma
organizationId String?
applicationId  String?
```

### 1.2 Create & run migration
```
npx prisma migrate dev --name add-applicationid-to-organization-and-refreshtoken
```

---

## Phase 2 — Interfaces & Types

### 2.1 `src/common/interfaces/jwt-payload.interface.ts`
- Add `applicationId?: string` to `JwtUserPayload`

### 2.2 `src/common/interfaces/auth-user.interface.ts`
- Add `applicationId?: string` to `AuthUser`

---

## Phase 3 — Auth System

### 3.1 `src/modules/auth/auth.service.ts`

| Area | Change |
|------|--------|
| `TokenInput` | Add `applicationId?: string` |
| `register()` | Accept `applicationId` from DTO. Validate app exists if provided. Create org with `applicationId`. Pass to token generation. |
| `login()` | Accept optional `applicationId` param. If provided, find user's org in that app. Resolve claims with `applicationId`. Generate tokens with `applicationId`. |
| `refreshTokens()` | Read `organizationId` and `applicationId` from stored RefreshToken. Use them to resolve claims and generate tokens. |
| `switchOrganization()` | Look up target org's `applicationId`. Resolve claims with it. Generate tokens with it. |
| `generateTokens()` | Add `applicationId` to JWT payload |
| `storeRefreshToken()` | Accept and store `organizationId` + `applicationId` on RefreshToken |
| `resolveUserClaims()` | Add `applicationId?: string` param. Filter roles: `applicationId IS NULL OR applicationId = :applicationId` |
| `buildAuthUser()` | Update cast type to include `organization.applicationId`. Set `applicationId` from first org. |

### 3.2 `src/modules/auth/dto/login.dto.ts`
- Add optional `applicationId` field (`@IsUUID()`, `@IsOptional()`)

### 3.3 `src/modules/auth/dto/register.dto.ts`
- Add optional `applicationId` field (`@IsUUID()`, `@IsOptional()`)

### 3.4 `src/modules/auth/auth.controller.ts`
- `login()`: Pass `_loginDto.applicationId` to `authService.login(req.user, applicationId)`
- `register()`: DTO now includes `applicationId` — no controller change needed
- `googleAuthRedirect()`: No change — uses default org context

---

## Phase 4 — Organizations Module

### 4.1 `src/modules/organizations/dto/create-organization.dto.ts`
- Add optional `applicationId` field

### 4.2 `src/modules/organizations/organizations.repository.ts`
- `findAll()`: Add `applicationId` filter param
- `findBySlug()`: Accept optional `applicationId`, change `findUnique` to `findFirst`
- `create()`: Add `applicationId` to data type

### 4.3 `src/modules/organizations/organizations.service.ts`
- `create()`: Pass `applicationId` through. Validate application exists if provided.
- `findAll()`: Pass `applicationId` filter through.
- `addMember()`: Validate role-app consistency (role must be global or match org's app)
- `findBySlug()`: Pass `applicationId` through

### 4.4 `src/modules/organizations/organizations.controller.ts`
- `findAll()`: Add `@Query('applicationId')` query param
- `findBySlug()`: Add `@Query('applicationId')` query param

---

## Phase 5 — IAM Module

### 5.1 `src/modules/iam/roles/roles.repository.ts`
- `findRolesByUserAndOrg()`: Add `applicationId?: string` param. Filter: `applicationId: { in: [null, applicationId] }` when provided.

### 5.2 `src/modules/iam/access/access.service.ts`
- `getUserPermissions()`: Add `applicationId?: string` param. Update cache key to `${userId}:${orgId}:${appId ?? 'global'}:${roles}`. Pass to `findRolesByUserAndOrg()`.
- `hasPermission()`: Add `applicationId?: string` param. Pass through.
- `clearCache()`: Update key pattern to include applicationId segment.
- `getUserOrganizations()`: Add `applicationId?: string` filter. Include `applicationId` in response.

### 5.3 `src/modules/iam/access/access.controller.ts`
- `checkPermission()`: Add `@Query('applicationId')` param. Use JWT `applicationId` as fallback.
- `myPermissions()`: Pass `user.applicationId` from JWT.
- `myOrganizations()`: Add `@Query('applicationId')` filter param.

---

## Phase 6 — Users Module

### 6.1 `src/modules/users/users.service.ts`
- `UserWithRoles`: Add `applicationId` to organization shape
- `findAll()`: Add `applicationId?: string` param
- `findById()`: Include `applicationId` in org response

### 6.2 `src/modules/users/users.repository.ts`
- `findAll()`: Add `applicationId` filter (join through UserRole → Organization)

### 6.3 `src/modules/users/users.controller.ts`
- `findAll()`: Add `@Query('applicationId')` query param

---

## Phase 7 — WebSocket Gateway

### 7.1 `src/modules/notifications/websocket/websocket.gateway.ts`
- `DecodedUserToken`: Add `applicationId?: string`
- `handleConnection()`: Optionally join `app:${applicationId}` room

---

## Phase 8 — Seed Script

### 8.1 `prisma/seed.ts`
- System Organization: Keep `applicationId: null` (global org)
- No other changes needed

---

## No Change Needed (Confirmed)

| File | Reason |
|------|--------|
| Guards (jwt-auth, roles, permissions) | Read from JWT payload — adapts automatically |
| JWT strategy | `validate(payload) { return payload; }` — adapts automatically |
| Local strategy | Returns user from validateUser() — adapts through buildAuthUser() |
| Google strategy | Returns user from validateGoogleUser() — adapts through buildAuthUser() |
| AuditLog schema | Already has applicationId column |
| Storage module | Uses organizationId for namespacing — no change needed |
| Audit module | Postponed feature — no change needed |
| Health module | No org context |
| Notifications service | Org-level targeting unchanged |

---

## Files Changed (18 total)

| # | File | Priority |
|---|------|----------|
| 1 | `prisma/schema.prisma` | P0 |
| 2 | `src/common/interfaces/jwt-payload.interface.ts` | P0 |
| 3 | `src/common/interfaces/auth-user.interface.ts` | P0 |
| 4 | `src/modules/auth/auth.service.ts` | P0 |
| 5 | `src/modules/auth/dto/login.dto.ts` | P0 |
| 6 | `src/modules/auth/dto/register.dto.ts` | P1 |
| 7 | `src/modules/auth/auth.controller.ts` | P1 |
| 8 | `src/modules/organizations/dto/create-organization.dto.ts` | P1 |
| 9 | `src/modules/organizations/organizations.repository.ts` | P1 |
| 10 | `src/modules/organizations/organizations.service.ts` | P1 |
| 11 | `src/modules/organizations/organizations.controller.ts` | P1 |
| 12 | `src/modules/iam/roles/roles.repository.ts` | P1 |
| 13 | `src/modules/iam/access/access.service.ts` | P1 |
| 14 | `src/modules/iam/access/access.controller.ts` | P1 |
| 15 | `src/modules/users/users.service.ts` | P2 |
| 16 | `src/modules/users/users.repository.ts` | P2 |
| 17 | `src/modules/users/users.controller.ts` | P2 |
| 18 | `src/modules/notifications/websocket/websocket.gateway.ts` | P2 |

## Execution Order

```
Phase 1 (schema + migration) → Phase 2 (interfaces) → Phase 3 (auth) → Phase 4 (orgs)
→ Phase 5 (IAM) → Phase 6 (users) → Phase 7 (websocket) → Phase 8 (seed)
→ lint + build + verify
```
