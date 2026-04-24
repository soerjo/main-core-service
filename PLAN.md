# Main Core Service — Refactoring Plan

## 1. Vision

One NestJS modular monolith that serves as the central identity & platform hub for all business apps (pharmacy, warehouse, market, transactions). Downstream services validate JWTs issued by this platform and optionally call its API for permission checks.

**Project:** `main-core-service`
**Approach:** Modular monolith — one app, one database, clean module boundaries. Extract into separate services later when scale demands it.
**Team:** Solo / 2-3 devs
**Deployment:** Docker Compose on single VPS

---

## 2. Architecture

```
  ┌─────────────────────────────────────────────────────────┐
  │                main-core-service (:3000)               │
  │                                                         │
  │  Modules:                                               │
  │    auth/          login, register, OAuth, JWT, passwords │
  │    users/         profile CRUD, avatars                  │
  │    organizations/ multi-tenant org management            │
  │    iam/           roles, permissions, access control      │
  │    applications/  register business apps, client creds    │
  │    notifications/ email (SMTP) + WebSocket push           │
  │    storage/       MinIO upload/download                   │
  │    audit/         immutable event log                     │
  │    health/        DB + MinIO health checks                │
  │                                                         │
  │  Infrastructure:                                        │
  │    PostgreSQL   — shared DB, module-owned tables         │
  │    MinIO        — S3-compatible object storage           │
  │    Socket.IO    — WebSocket server                       │
  │    EventEmitter2 — in-process event bus                  │
  └────────────────────────┬────────────────────────────────┘
                           │ JWT (ES256, public/private key)
             ┌──────────────┼──────────────────────────┐
             │              │                          │
      pharmacy-app    warehouse-app    market-app    transaction-service
      (verifies via   (verifies via    (verifies via  (client_credentials
       public key)     public key)      public key)    OAuth2 flow)
```

### How downstream services integrate

1. **User auth** — each app verifies JWT locally using the public key (`JWT_PUBLIC_KEY` env var). No HTTP call needed.
2. **Permission checks** — JWT includes roles; apps call `GET /api/v1/iam/check` for specific permission verification.
3. **Service auth** — transaction service authenticates via OAuth2 client credentials, gets its own JWT.
4. **Shared library** — `@main-core/auth-client` npm package with guards, types, and API client.

---

## 3. Database Schema

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// ─── Users ────────────────────────────────────────────────

model User {
  id                    String    @id @default(uuid())
  email                 String    @unique
  password              String
  firstName             String?
  lastName              String?
  avatarUrl             String?
  phone                 String?
  isActive              Boolean   @default(true)
  createdAt             DateTime  @default(now())
  updatedAt             DateTime  @updatedAt

  userRoles             UserRole[]
  passwordResets        PasswordReset[]
  auditLogs             AuditLog[]

  @@map("users")
}

// ─── Organizations (multi-tenant boundaries) ─────────────

model Organization {
  id        String   @id @default(uuid())
  name      String
  slug      String   @unique
  logoUrl   String?
  isActive  Boolean  @default(true)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  userRoles    UserRole[]
  auditLogs    AuditLog[]

  @@map("organizations")
}

// ─── Applications (downstream business apps) ──────────────

model Application {
  id           String   @id @default(uuid())
  name         String   @unique        // "pharmacy", "warehouse", "market", "transactions"
  displayName  String                  // "Pharmacy App"
  description  String?
  clientId     String   @unique        // OAuth2 client ID (UUID)
  clientSecret String                  // bcrypt-hashed client secret
  redirectUris String?                 // JSON array of allowed redirect URIs
  isActive     Boolean  @default(true)
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  roles        Role[]
  permissions  Permission[]
  auditLogs    AuditLog[]

  @@map("applications")
}

// ─── Roles ────────────────────────────────────────────────

model Role {
  id            String    @id @default(uuid())
  name          String                    // "admin", "pharmacist", "cashier"
  displayName   String                    // "Administrator"
  description   String?
  isSystem      Boolean   @default(false) // system roles cannot be deleted
  applicationId String?                   // null = global role, set = app-specific
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  application     Application?  @relation(fields: [applicationId], references: [id], onDelete: Cascade)
  rolePermissions RolePermission[]
  userRoles       UserRole[]

  @@unique([name, applicationId])
  @@map("roles")
}

// ─── Permissions ──────────────────────────────────────────

model Permission {
  id            String   @id @default(uuid())
  name          String   @unique        // "inventory:write", "orders:read"
  displayName   String                  // "Create/Edit Inventory"
  module        String                  // "inventory", "orders", "users"
  action        String                  // "read", "write", "delete", "manage"
  description   String?
  applicationId String?                 // null = global, set = app-specific
  createdAt     DateTime @default(now())

  application     Application?  @relation(fields: [applicationId], references: [id], onDelete: Cascade)
  rolePermissions RolePermission[]

  @@map("permissions")
}

// ─── Role <-> Permission ──────────────────────────────────

model RolePermission {
  id           String     @id @default(uuid())
  roleId       String
  permissionId String
  role         Role       @relation(fields: [roleId], references: [id], onDelete: Cascade)
  permission   Permission @relation(fields: [permissionId], references: [id], onDelete: Cascade)

  @@unique([roleId, permissionId])
  @@map("role_permissions")
}

// ─── User <-> Role <-> Organization ───────────────────────

model UserRole {
  id             String       @id @default(uuid())
  userId         String
  roleId         String
  organizationId String
  createdAt      DateTime     @default(now())

  user           User         @relation(fields: [userId], references: [id], onDelete: Cascade)
  role           Role         @relation(fields: [roleId], references: [id], onDelete: Cascade)
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  @@unique([userId, roleId, organizationId])
  @@index([userId, organizationId])
  @@map("user_roles")
}

// ─── Password Resets ─────────────────────────────────────

model PasswordReset {
  id        String   @id @default(uuid())
  userId    String
  token     String   @unique        // bcrypt-hashed reset token
  expiresAt DateTime
  usedAt    DateTime?
  createdAt DateTime @default(now())

  user      User      @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, createdAt])
  @@map("password_resets")
}

// ─── Audit Log ───────────────────────────────────────────

model AuditLog {
  id             String    @id @default(uuid())
  userId         String?
  applicationId  String?
  action         String     // "user.login", "role.created", "permission.granted"
  resource       String?    // "user:<uuid>", "organization:<uuid>"
  ipAddress      String?
  userAgent      String?
  metadata       Json?
  organizationId String?
  createdAt      DateTime   @default(now())

  user        User?        @relation(fields: [userId], references: [id])
  application Application? @relation(fields: [applicationId], references: [id])

  @@index([userId, createdAt])
  @@index([action, createdAt])
  @@index([organizationId, createdAt])
  @@map("audit_logs")
}
```

### Schema decisions

| Decision | Rationale |
|----------|-----------|
| No `primaryOrganizationId` on User | Organization context lives in JWT. User selects org at login or via switch endpoint. Simpler, no stale default. |
| `PasswordReset` table instead of `forgotPasswordUrl` field | Proper token lifecycle: creation, expiration, usage tracking. Auditable. Supports multiple concurrent resets. |
| `isActive` on User and Organization | Soft delete pattern. Checked in login and JWT strategy. Never hard-delete entities with relationships. |
| `Application.clientSecret` is bcrypt-hashed | Same pattern as user passwords. Never store in plain text. One-time display on creation. |
| `Role.applicationId` nullable | `null` = global role (cross-app like "admin"). Set = app-specific (like "pharmacist"). |
| No cascade delete on Organization→UserRole | Prevents accidental data loss when deactivating orgs. Orgs are soft-deleted via `isActive`. |
| `AuditLog` is append-only | No update/delete operations. Indexed for common query patterns. Archive to cold storage after 90 days. |

---

## 4. JWT Design

### Signing: ES256 (ECDSA P-256) asymmetric keys

This service signs JWTs with a **private key**. Downstream services verify with the **public key**. If a downstream service is compromised, the attacker cannot forge tokens.

| Operation | Key used | Who has it |
|-----------|----------|-----------|
| Sign tokens | Private key (`ec-private.pem`) | This service only |
| Verify tokens | Public key (`ec-public.pem`) | All downstream services + JWKS endpoint |

**Key generation:**
```bash
# Generate ES256 private key
openssl ecparam -name prime256v1 -genkey -noout -out ec-private.pem

# Extract public key
openssl ec -in ec-private.pem -pubout -out ec-public.pem
```

- **Distribution:** put `JWT_PUBLIC_KEY` PEM content in the env var of each downstream service. Simple, no dynamic fetching needed at this scale.

**Key rotation:** generate a new key pair, update `JWT_PRIVATE_KEY`/`JWT_PUBLIC_KEY` in this service and all downstream services, then redeploy. For your scale (2-4 services), this takes minutes. Add JWKS later to automate this.

### User JWT (login/register)

```jsonc
{
  "sub": "user-uuid",
  "email": "user@example.com",
  "type": "user",
  "organizationId": "org-uuid",
  "roles": ["admin", "pharmacist"],
  "iat": 1234567890,
  "exp": 1234567890
}
```

### Service JWT (client credentials)

```jsonc
{
  "sub": "transactions",
  "type": "service",
  "applicationId": "app-uuid",
  "permissions": ["transactions:process", "users:read"],
  "iat": 1234567890,
  "exp": 1234567890
}
```

### Why roles in JWT but not permissions

- Roles change infrequently (admin assigns/removes roles occasionally).
- Permissions change more often (admin edits role's permission set).
- If permissions were in JWT, revoking a permission would require reissuing all user tokens.
- Instead: JWT has roles. Permission resolution happens server-side with in-memory cache (5 min TTL).
- Downstream services that need specific permission checks call `GET /api/v1/iam/check`.

### Refresh token rotation

- Refresh tokens are stored in `PasswordReset`-style table (or a dedicated `RefreshToken` table).
- When a refresh token is used: invalidate old token, issue new pair.
- Detects token replay: if an already-used refresh token is presented, revoke all refresh tokens for that user.
- On logout: delete refresh token from storage.

### Organization switching

`POST /api/v1/auth/switch-organization`

- Validates user has at least one role in the target organization.
- Issues new JWT with different `organizationId`.
- Returns same shape as login response.

---

## 5. Module Breakdown

```
src/
  main.ts
  app.module.ts
  config/
    env.validation.ts
    logger.config.ts
  prisma/
    prisma.module.ts
    prisma.service.ts
  common/
    decorators/
      current-user.decorator.ts       # @CurrentUser()
      public.decorator.ts             # @Public()
      roles.decorator.ts              # @Roles('admin')
      permissions.decorator.ts        # @Permissions('inventory:write') — NEW
    filters/
      all-exceptions.filter.ts
    guards/
      jwt-auth.guard.ts               # validates JWT, respects @Public()
      roles.guard.ts                  # reads roles from JWT payload (zero DB hits)
      permissions.guard.ts            # resolves roles → permissions via cache — NEW
      client-credentials.guard.ts     # OAuth2 client_credentials — NEW
    interceptors/
      response-transform.interceptor.ts
    interfaces/
      jwt-payload.interface.ts        # typed user + service JWT payloads
    pipes/
      parse-uuid.pipe.ts              # UUID validation for path params — NEW
    utils/
      duration.ts                     # parse "15m"/"7d" → seconds — NEW
      pagination.ts                   # pagination helper types — NEW
  modules/
    auth/
      auth.module.ts
      auth.controller.ts
      auth.service.ts
      local-auth.guard.ts
      google-auth.guard.ts
      strategies/
        local.strategy.ts
        jwt.strategy.ts
        google.strategy.ts
        client-credentials.strategy.ts    # NEW
      dto/
        register.dto.ts
        login.dto.ts
        refresh-token.dto.ts
        set-password.dto.ts
        change-password.dto.ts
        forgot-password.dto.ts
        reset-password.dto.ts
        client-credentials.dto.ts         # NEW
        switch-organization.dto.ts        # NEW
    users/
      users.module.ts
      users.controller.ts
      users.service.ts
      users.repository.ts
      dto/
        create-user.dto.ts
        update-user.dto.ts
        update-profile.dto.ts             # NEW
    organizations/
      organizations.module.ts
      organizations.controller.ts
      organizations.service.ts
      organizations.repository.ts
      dto/
        create-organization.dto.ts
        update-organization.dto.ts
        add-member.dto.ts                 # NEW
    iam/
      iam.module.ts
      roles/
        roles.controller.ts
        roles.service.ts
        roles.repository.ts
        dto/
          create-role.dto.ts
          update-role.dto.ts
          assign-permissions.dto.ts
      permissions/
        permissions.controller.ts
        permissions.service.ts
        permissions.repository.ts
        dto/
          create-permission.dto.ts
      access/
        access.controller.ts              # /iam/check, /iam/my-permissions
        access.service.ts                 # permission resolution + caching
    applications/
      applications.module.ts
      applications.controller.ts
      applications.service.ts
      applications.repository.ts
      dto/
        create-application.dto.ts
        update-application.dto.ts
    notifications/
      notifications.module.ts
      notifications.controller.ts
      notifications.service.ts
      email/
        email.service.ts
        templates/
          forgot-password.html
          welcome.html
      websocket/
        websocket.gateway.ts
    storage/
      storage.module.ts
      storage.controller.ts
      storage.service.ts
      dto/
        upload-file.dto.ts
    audit/
      audit.module.ts
      audit.controller.ts
      audit.service.ts
      audit.repository.ts
      dto/
        query-audit.dto.ts
    health/
      health.module.ts
      health.controller.ts
      indicators/
        prisma.health.indicator.ts
        minio.health.indicator.ts          # NEW
```

---

## 6. Route Map

All routes under global prefix `/api/v1`.

### Auth (`/api/v1/auth`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/register` | Public | Register — auto-creates org, assigns admin role |
| POST | `/login` | Public + LocalAuthGuard | Login, returns `{ accessToken, refreshToken, user, organization }` |
| GET | `/google` | Public + GoogleAuthGuard | Google OAuth redirect |
| GET | `/google/callback` | Public + GoogleAuthGuard | Google OAuth callback |
| GET | `/verify-token` | JWT | Validates token, returns user + roles + permissions |
| POST | `/refresh-token` | Public | Refresh token (rotation: old token invalidated) |
| POST | `/set-password` | JWT | Set password for OAuth users |
| POST | `/change-password` | JWT | Change password (requires current password) |
| POST | `/forgot-password` | Public | Send reset email |
| POST | `/reset-password` | Public | Reset password via token |
| POST | `/token` | Public (client_credentials) | OAuth2 client credentials grant |
| POST | `/switch-organization` | JWT | Switch org context, get new JWT |
| POST | `/logout` | JWT | Invalidate refresh token |

### Users (`/api/v1/users`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/me` | JWT | Current user profile + roles + org memberships |
| PATCH | `/me` | JWT | Update own profile |
| POST | `/me/avatar` | JWT | Upload avatar |
| GET | `/` | `users:read` | List users (paginated, org-scoped) |
| GET | `/:id` | `users:read` | Get user by ID |
| POST | `/` | `users:write` | Create user (assigns role) |
| PATCH | `/:id` | `users:write` | Update user |
| PATCH | `/:id/status` | `users:write` | Activate/deactivate user |

### Organizations (`/api/v1/organizations`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/` | Public | List organizations |
| GET | `/:id` | Public | Get organization |
| GET | `/slug/:slug` | Public | Get organization by slug |
| POST | `/` | `organizations:write` | Create organization |
| PATCH | `/:id` | `organizations:write` | Update organization |
| PATCH | `/:id/status` | `organizations:write` | Activate/deactivate |
| POST | `/:id/logo` | `organizations:write` | Upload org logo |
| GET | `/:id/members` | `organizations:read` | List org members with roles |
| POST | `/:id/members` | `organizations:write` | Add user to org with role |
| PATCH | `/:id/members/:userId` | `organizations:write` | Update member role |
| DELETE | `/:id/members/:userId` | `organizations:write` | Remove member from org |

### IAM — Roles (`/api/v1/roles`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/` | `roles:read` | List roles (filterable by application) |
| GET | `/:id` | `roles:read` | Get role with permissions |
| POST | `/` | `roles:write` | Create role |
| PATCH | `/:id` | `roles:write` | Update role |
| DELETE | `/:id` | `roles:delete` | Delete role (not system roles) |
| POST | `/:id/permissions` | `roles:write` | Assign permissions to role |
| DELETE | `/:id/permissions/:permissionId` | `roles:write` | Remove permission from role |

### IAM — Permissions (`/api/v1/permissions`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/` | `permissions:read` | List (filterable by application, module) |
| GET | `/:id` | `permissions:read` | Get permission |
| POST | `/` | `permissions:write` | Create permission |
| DELETE | `/:id` | `permissions:delete` | Delete permission |

### IAM — Access (`/api/v1/iam`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/check` | JWT | Check permission (`?permission=inventory:write&organizationId=...`) |
| GET | `/my-permissions` | JWT | All permissions for current user in current org |
| GET | `/my-organizations` | JWT | Organizations the current user belongs to |

### Applications (`/api/v1/applications`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/` | `applications:read` | List registered apps |
| GET | `/:id` | `applications:read` | Get app details |
| POST | `/` | `applications:write` | Register app (returns clientId + plain-text clientSecret once) |
| PATCH | `/:id` | `applications:write` | Update app |
| PATCH | `/:id/status` | `applications:write` | Activate/deactivate |
| POST | `/:id/regenerate-secret` | `applications:write` | Generate new clientSecret |

### Notifications (`/api/v1/notifications`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/` | JWT | Get user's notifications |
| PATCH | `/:id/read` | JWT | Mark as read |
| PATCH | `/read-all` | JWT | Mark all as read |
| WebSocket | `/ws` | JWT (handshake) | Real-time push via Socket.IO |

### Storage (`/api/v1/storage`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/upload` | JWT | Upload file |
| GET | `/:key/presign` | JWT | Get presigned download URL |
| DELETE | `/:key` | `storage:delete` | Delete file |

### Audit (`/api/v1/audit`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/` | `audit:read` | Query logs (filter by user, action, org, date) |

### Health (`/api/v1/health`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/` | Public | DB + MinIO health check |

### Well-known (deferred — add when needed)

JWKS (`/.well-known/jwks.json`) and OpenID discovery (`/.well-known/openid-configuration`) are deferred. For now, downstream services use `JWT_PUBLIC_KEY` env var directly. Add JWKS later when you have 10+ services or need third-party integration.

---

## 7. Guard Design

### Guard chain (global, in order)

```
ThrottlerGuard → JwtAuthGuard → PermissionsGuard
```

### JwtAuthGuard (updated)

- Verifies JWT signature using the **public key** (ES256).
- Respects `@Public()` decorator.
- Handles two JWT types:
  - `type: "user"` — standard user token, attaches `request.user` with `{ id, email, organizationId, roles, type }`
  - `type: "service"` — service account token, attaches `request.service` with `{ applicationId, permissions, type }`
- Checks `isActive` on user accounts (via cached user state, not DB hit on every request).

### RolesGuard (rewritten)

- **Current problem:** queries DB on every request to get user role.
- **Fix:** reads roles directly from JWT payload. Zero DB hits.
- When a user's roles change, they need a new JWT (via re-login or token refresh).

### PermissionsGuard (new)

```typescript
// Usage
@Permissions('inventory:write')
@Post()
async createInventory() { ... }
```

- Reads `@Permissions()` decorator.
- For service JWTs: checks permissions directly from token payload.
- For user JWTs: resolves roles → permissions via `AccessService` with in-memory cache (5 min TTL).
- Returns 403 if not authorized.

### Per-endpoint rate limiting

```typescript
// Use @Throttle() per endpoint instead of global 10 req/60s
@Throttle({ default: { limit: 5, ttl: 60000 } })   // login: 5 req/min
@Post('login')
login() { ... }

@Public()
@Throttle({ default: { limit: 3, ttl: 60000 } })    // register: 3 req/min
@Post('register')
register() { ... }
```

### Account lockout

- Track failed login attempts in-memory or Redis.
- After 5 consecutive failures on same email: lock for 15 minutes.
- Reset counter on successful login.
- Return generic "Invalid credentials" regardless (don't reveal whether email exists).

---

## 8. Notification Design

### Email

- Same `nodemailer` + HTML template approach.
- Fix: re-throw errors (remove commented-out `throw error`).
- Templates: `forgot-password.html`, `welcome.html`, `reset-password.html`.

### WebSocket (Socket.IO)

```
Client connects to /ws with JWT in handshake auth
  → Server validates JWT
  → Server joins user to rooms: user:{userId}, org:{orgId}
  → Server listens for disconnect

Server pushes:
  → sendToUser(userId, event, data)
  → sendToOrg(orgId, event, data)
  → broadcast(event, data)
```

### In-process event bus (EventEmitter2)

No RabbitMQ. Modules communicate via NestJS built-in `EventEmitter2`:

```typescript
// auth.module.ts — emit after registration
this.eventEmitter.emit('user.registered', { userId, email, firstName });

// notifications.service.ts — listen and send email
@OnEvent('user.registered')
async handleWelcome(data) {
  await this.emailService.sendMail({ ... });
  this.websocketGateway.sendToUser(data.userId, 'notification', { ... });
}
```

---

## 9. Storage Design (MinIO)

### File structure

```
{bucket}/{organizationId}/{module}/{uuid}.{ext}
e.g., main-core/org-123/users/avatar-456.jpg
      main-core/org-123/organizations/logo-789.png
```

### Upload flow

1. Client sends `multipart/form-data` to `POST /api/v1/storage/upload`.
2. Server validates: max size (5MB), allowed MIME types (images only for avatars/logos).
3. Server generates key, uploads to MinIO.
4. Returns `{ key, url, size, mimeType }`.

### Download flow

- `GET /api/v1/storage/:key/presign` — returns a presigned URL (time-limited, no proxy needed).
- Public assets (org logos, user avatars): set bucket policy for public read.

### Security

- Filename sanitization.
- MIME type validation (not just extension).
- Max file size per type (avatar: 2MB, logo: 5MB, general: 10MB).
- Future: virus scanning for pharmacy compliance.

---

## 10. Audit Design

### What gets logged

| Event | Action name | Trigger |
|-------|-------------|---------|
| User login | `user.login` | AuthService.login |
| User login failed | `user.login_failed` | LocalStrategy |
| User registered | `user.registered` | AuthService.register |
| Password changed | `user.password_changed` | AuthService.changePassword |
| Password reset requested | `user.password_reset_requested` | AuthService.forgotPassword |
| Password reset completed | `user.password_reset_completed` | AuthService.resetPassword |
| Role created/updated/deleted | `role.created` etc. | RolesService |
| Permission assigned | `permission.assigned` | RolesService.assignPermissions |
| User role assigned | `user_role.assigned` | UserRolesService |
| Application registered | `application.registered` | ApplicationsService |
| Organization created | `organization.created` | OrganizationsService |

### Implementation

```typescript
// Modules emit events
this.eventEmitter.emit('audit.log', {
  action: 'user.login',
  userId: user.id,
  organizationId: user.organizationId,
  ipAddress: request.ip,
  userAgent: request.headers['user-agent'],
});

// AuditService listens and persists
@OnEvent('audit.log')
async handleAuditLog(data: AuditLogDto) {
  await this.auditRepository.create(data);
}
```

### Query & retention

- Query via `GET /api/v1/audit` with filters (user, action, org, date range, pagination).
- Archive logs older than 90 days to cold storage (implement as a scheduled task later).

---

## 11. Login Flow (Detailed)

### Registration

```
POST /api/v1/auth/register
  → Check email uniqueness
  → Hash password
  → Transaction:
      1. Create organization (slug: org-{uuid})
      2. Create user (isActive: true)
      3. Create UserRole (user + "admin" role + organization)
  → Issue access + refresh tokens
  → Emit "user.registered" event → notification service sends welcome email
  → Emit "audit.log" event
  → Return { accessToken, refreshToken, user, organization }
```

### Login

```
POST /api/v1/auth/login
  → LocalAuthGuard → LocalStrategy:
      1. Find user by email
      2. Check isActive
      3. Compare password
      4. Return AuthUser
  → Resolve user's roles for first available organization
  → Issue JWT with { sub, email, type, organizationId, roles }
  → Store refresh token
  → Check failed login counter, reset on success
  → Emit "audit.log" event
  → Return { accessToken, refreshToken, user, organization }
```

### Multi-org login

If user has roles in multiple organizations:
- Login uses the first organization the user has a role in.
- Frontend calls `GET /api/v1/iam/my-organizations` to get the list.
- User can switch via `POST /api/v1/auth/switch-organization`.

### Client credentials

```
POST /api/v1/auth/token
  Body: { grantType: "client_credentials", clientId, clientSecret }
  → Validate clientId exists and isActive
  → Compare clientSecret (bcrypt)
  → Resolve application's permissions
  → Sign JWT with private key (ES256): { sub: appName, type: "service", applicationId, permissions }
  → Emit "audit.log" event
  → Return { accessToken, tokenType: "Bearer", expiresIn }
```

---

## 12. Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `NODE_ENV` | No | `development` | `development` \| `production` \| `test` |
| `PORT` | No | `3000` | Server port |
| `DATABASE_URL` | Yes | — | PostgreSQL connection string |
| `JWT_PRIVATE_KEY` | Yes | — | ES256 private key (PEM format) for signing tokens |
| `JWT_PUBLIC_KEY` | Yes | — | ES256 public key (PEM format) for verifying tokens |
| `JWT_ACCESS_EXPIRATION` | No | `900` | Access token TTL in **seconds** |
| `JWT_REFRESH_EXPIRATION` | No | `604800` | Refresh token TTL in **seconds** |
| `GOOGLE_CLIENT_ID` | No | — | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | No | — | Google OAuth client secret |
| `GOOGLE_CALLBACK_URL` | No | `http://localhost:3000/api/v1/auth/google/callback` | Google OAuth callback URL |
| `SMTP_HOST` | No | `localhost` | SMTP server host |
| `SMTP_PORT` | No | `587` | SMTP server port |
| `SMTP_USER` | No | `''` | SMTP auth user |
| `SMTP_PASS` | No | `''` | SMTP auth password |
| `SMTP_FROM` | No | `noreply@example.com` | Sender address |
| `FRONTEND_URL` | No | `http://localhost:5173` | Frontend URL for redirects/links |
| `MINIO_ENDPOINT` | No | `localhost` | MinIO endpoint |
| `MINIO_PORT` | No | `9000` | MinIO port |
| `MINIO_ACCESS_KEY` | No | `minioadmin` | MinIO access key |
| `MINIO_SECRET_KEY` | No | `minioadmin` | MinIO secret key |
| `MINIO_BUCKET` | No | `main-core` | Default bucket |
| `MINIO_USE_SSL` | No | `false` | Use HTTPS for MinIO |

**Key changes from current setup:**
- `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` are **replaced** by `JWT_PRIVATE_KEY` and `JWT_PUBLIC_KEY` (ES256 asymmetric keys). Same key pair used for both access and refresh tokens.
- JWT expiration uses raw **seconds** as integers. No string parsing. Eliminates the current `replace(/\D/g, '')` bug entirely.
- Private key content can be loaded from env var directly (PEM as string) or from a file path (set `JWT_PRIVATE_KEY_PATH` instead).
- Public key is shared with downstream services via their own `JWT_PUBLIC_KEY` env var.

---

## 13. Shared Library for Downstream Services

### `@main-core/auth-client` npm package

Published from a `packages/` directory in this repo (or separate repo).

```
packages/auth-client/
  src/
    guards/
      jwt-auth.guard.ts        # verifies JWT using public key (ES256)
      permissions.guard.ts     # checks permissions from JWT or API call
    interfaces/
      jwt-payload.interface.ts # typed JWT payloads
      auth-user.interface.ts   # AuthUser type
    services/
      auth-client.service.ts   # HTTP client for permission checks
    constants/
      roles.ts                 # role name constants
      permissions.ts           # permission name constants
  package.json
```

### Usage in downstream service (e.g., pharmacy-app)

```typescript
// pharmacy-app/src/app.module.ts
import { AuthClientModule } from '@main-core/auth-client';

@Module({
  imports: [
    AuthClientModule.forRoot({
      publicKey: process.env.JWT_PUBLIC_KEY,
      authServiceUrl: 'http://main-core-service:3000/api/v1',
    }),
  ],
})
export class AppModule {}

// pharmacy-app/src/modules/inventory/inventory.controller.ts
import { JwtAuthGuard, PermissionsGuard } from '@main-core/auth-client';
import { Permissions } from '@main-core/auth-client';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('inventory')
export class InventoryController {
  @Permissions('inventory:write')
  @Post()
  create() { ... }
}
```

---

## 14. Critical Fixes (Tech Debt)

These are bugs/anti-patterns in the current code that must be fixed during refactoring.

| Issue | Current | Fix |
|-------|---------|-----|
| Token expiry parsing | `replace(/\D/g, '') * 60` — `"7d"` becomes 420s instead of 7 days | Use raw seconds in env vars: `JWT_ACCESS_EXPIRATION=900` |
| Shared secret for JWT | `JWT_ACCESS_SECRET` shared with all services — any compromised service can forge tokens | ES256 asymmetric keys: private key signs, public key verifies |
| RolesGuard DB hit | Queries `prisma.user.findUnique()` on every request | Read roles from JWT payload |
| Double DB queries | `setPassword` and `changePassword` do `findById` then `findByEmail` | Use single `findById` with password included |
| Google hardcoded UUIDs | `organizationId: '4d977551-...'` | Remove. OAuth users created without org, prompted to join/create one |
| Email swallows errors | `throw error` commented out | Re-throw errors. Use event queue for retry. |
| Forgot password leaks info | Returns `{ to, subject, context, resetUrl }` in response | Return only `{ message: "If the email exists, a reset link will be sent" }` |
| No isActive check | Login/JWT strategy don't check `isActive` | Check in LocalStrategy and JwtStrategy.validate |
| Stale DTOs | `CreateUserDto` has `roleId`, `CreateOrganizationDto` has `description`/`website` | Remove fields that don't exist in schema |
| No refresh token rotation | Refresh tokens are pure JWTs, can't be revoked | Store in DB, rotate on use, detect replay |
| Tokens in URL params | Google callback puts tokens in redirect URL query string | Use short-lived authorization code or HTTP-only cookies |
| No UUID validation | Path params like `:id` accept any string | Add `ParseUUIDPipe` |
| Committed `.env` | Contains real secrets | Remove from git tracking, add to `.gitignore` |
| Duplicate config files | `.eslintrc.js` + `eslint.config.mjs`, `.example.env` + `.env.example` | Delete legacy files |
| Register org slug collision | `org-{email}` fails if same email registers twice | Use `org-{uuid}` or `org-{slugified-name}-{timestamp}` |
| No helmet/CORS config | `app.enableCors()` with no options, no security headers | Add helmet, configure explicit CORS origins |
| No password complexity | Only `MinLength(8)` | Add `@Matches()` with regex for uppercase, lowercase, number, special char |
| Test setup broken | `test-setup.ts` references stale env vars, e2e misconfigured | Rewrite test infrastructure |

---

## 15. Implementation Phases

### Phase 1: Rename + Cleanup (1-2 days)

- Rename project to `main-core-service` in `package.json`, `Dockerfile`, `docker-compose.yml`.
- Generate ES256 key pair (`ec-private.pem`, `ec-public.pem`) and add to `.gitignore`.
- Remove dead code: `.eslintrc.js`, `.example.env`, `src/common/constant.ts`.
- Fix stale DTOs: remove `roleId`, `description`, `website`.
- Fix `organizations.repository.ts` create method.
- Remove `.env` from git: `git rm --cached .env`.
- Add helmet: `npm i helmet`, apply in `main.ts`.
- Configure CORS with explicit origins from env var.
- Rewrite `test/test-setup.ts` and fix `test/app.e2e-spec.ts`.
- Add API versioning: change global prefix from `api` to `api/v1`.

### Phase 2: New Prisma Schema (2-3 days)

- Replace `prisma/schema.prisma` with the full schema above.
- Reset migration history: single clean migration.
- Create `prisma/seed.ts`:
  - System roles: `system_admin` (global), `org_admin` (global), `user` (global).
  - Global permissions: `users:read`, `users:write`, `users:delete`, `roles:read`, `roles:write`, `roles:delete`, `permissions:read`, `permissions:write`, `permissions:delete`, `organizations:read`, `organizations:write`, `organizations:delete`, `applications:read`, `applications:write`, `applications:delete`, `audit:read`, `storage:delete`.
  - Assign all permissions to `system_admin` and `org_admin`.

### Phase 3: IAM Module (3-4 days)

- Create IAM module with sub-modules: roles, permissions, access.
- CRUD for roles and permissions.
- Assign permissions to roles.
- Assign roles to users (scoped to organization).
- `AccessService` with permission resolution and in-memory cache.
- `@Permissions()` decorator + `PermissionsGuard`.

### Phase 4: Applications Module (1-2 days)

- CRUD for applications.
- `clientId` generated as UUID, `clientSecret` generated as random hex string (bcrypt-hashed for storage).
- `regenerateSecret` — generates new secret, returns plain text once.

### Phase 5: Auth Module Rewrite (2-3 days)

- **ES256 key-based JWT signing** — load private key from env, sign all tokens with ES256.
- Fix token expiry: use raw seconds from env vars.
- New JWT payload structure with `type`, `organizationId`, `roles`.
- Registration creates org + user + UserRole assignment in transaction.
- Login resolves user's roles for an organization.
- Refresh token rotation with storage.
- Client credentials strategy (`POST /auth/token`).
- Switch organization endpoint.
- Logout endpoint (invalidates refresh token).
- Fix `forgotPassword`: use `PasswordReset` table, don't leak info in response.
- Fix `setPassword/changePassword`: single DB query.
- Fix Google OAuth: no hardcoded UUIDs.
- Add `isActive` check in login and JWT validation.
- Add account lockout for failed logins.
- Emit audit events.

### Phase 6: Users Module Update (1-2 days)

- Remove `role` enum field dependency (roles now via UserRole).
- Add `phone`, `avatarUrl` fields.
- `GET /me` returns user + roles + org memberships.
- `PATCH /me` for profile updates.
- Admin CRUD uses `@Permissions('users:read')` etc.
- Add `ParseUUIDPipe` on path params.
- Add pagination to list endpoint.

### Phase 7: Organizations Module Update (1 day)

- Fix stale DTO fields.
- Add member management endpoints.
- Logo upload via storage module.
- Add `isActive` soft delete.

### Phase 8: Notifications Module (2-3 days)

- Move email service from `modules/email` to `modules/notifications/email`.
- Fix error swallowing.
- Add welcome email template.
- Socket.IO gateway with JWT handshake auth.
- User rooms: `user:{userId}`, `org:{orgId}`.
- `NotificationsService` unified interface.
- Wire up event listeners for auth events.

### Phase 9: Storage Module (2-3 days)

- MinIO client configuration.
- Upload endpoint with multer + file validation.
- Presigned URL generation.
- File key structure: `{orgId}/{module}/{uuid}.{ext}`.
- Integrate with users (avatar) and organizations (logo).

### Phase 10: Audit Module (1-2 days)

- Audit service listening on `audit.log` events.
- Query endpoint with filters and pagination.
- Wire up all modules to emit audit events.

### Phase 11: Guards & Common Update (1 day)

- Update `JwtAuthGuard` for user + service JWT types, verify with public key (ES256).
- Rewrite `RolesGuard` (JWT payload, no DB).
- New `PermissionsGuard` with cache.
- New `ParseUUIDPipe`.
- New `duration.ts` utility (if needed for backward compat).

### Phase 12: Health Module Update (0.5 day)

- Add MinIO health indicator.

### Phase 13: Tests (3-4 days)

- Unit tests for every service and repository.
- E2E tests for all endpoints.
- Test fixtures and seed data.

### Phase 14: Docker Compose + Docs (1 day)

- Update `Dockerfile` and `docker-compose.yml`.
- Add MinIO service to compose.
- Update `AGENTS.md`.
- Create `.env.example` with all new vars.

### Phase 15: Shared Library (2-3 days)

- Create `packages/auth-client/` with guards, types, and HTTP client.
- Publish as npm package or use as workspace dependency.

---

## 16. Execution Priority

**Must do first (core functionality):**
1. Phase 1 (rename + cleanup)
2. Phase 2 (schema)
3. Phase 3 (IAM)
4. Phase 5 (auth rewrite)

**Must do second (existing module adaptation):**
5. Phase 6 (users update)
6. Phase 7 (organizations update)
7. Phase 11 (guards)

**Can do in parallel or after core:**
8. Phase 4 (applications)
9. Phase 8 (notifications)
10. Phase 9 (storage)
11. Phase 10 (audit)

**Polish:**
12. Phase 12 (health)
13. Phase 13 (tests)
14. Phase 14 (docker + docs)
15. Phase 15 (shared library)

**Total estimated effort: ~20-30 days for a solo developer.**

---

## 17. Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Schema migration loses existing data | High | Write data migration script. Backup DB before migration. |
| JWT payload too large with roles | Low | Roles are short strings. Even 20 roles < 1KB. Monitor token size. |
| Permission cache stale after role change | Low | 5 min TTL is acceptable. Admin can force cache bust via API. |
| MinIO downtime blocks file uploads | Medium | Graceful degradation: return error, frontend retries. MinIO is highly available. |
| In-process events lost on crash | Medium | Audit events use DB writes (durable). Email retries via queue. Notification events are best-effort. |
| Over-engineering for current scale | Medium | Each module is independently usable. Skip modules you don't need yet. |

---

## 18. What NOT to Build (Yet)

These were considered and deliberately deferred:

| Feature | Why defer |
|---------|-----------|
| OAuth2 authorization server (full) | Start with shared JWT + client credentials. Add OAuth2 flows when you have 3+ business apps. |
| JWKS + OpenID discovery | Put public key in env var of each service. Add `/.well-known/jwks.json` when you have 10+ services or need third-party integration. |
| RabbitMQ / message broker | In-process `EventEmitter2` is sufficient for a monolith. Add when extracting services. |
| Redis for caching/sessions | In-memory cache for permissions is enough. Add Redis when you need multi-instance scaling. |
| Rate limiting with Redis | In-memory rate limiting is fine for single-instance. |
| WebSocket Redis adapter | Single instance doesn't need it. Add when running multiple instances. |
| Two-factor authentication (2FA) | Add later as a module. Design doesn't block it. |
| Social login beyond Google | Strategy pattern makes adding providers easy. Add on demand. |
| API gateway (separate service) | This IS the gateway for now. Extract when needed. |
| GraphQL | REST is simpler and sufficient. Add only if frontend demands it. |
