# AGENTS.md

## Commands

- `npm run build` — nest build (output to `dist/`, cleared each build)
- `npm run start:dev` — dev server with watch (port 3000, overridable via `PORT` env)
- `npm run lint` — eslint with auto-fix (flat config at `eslint.config.mjs`)
- `npm run test` — unit tests (jest, `src/**/*.spec.ts`)
- `npm run test:e2e` — e2e tests (jest, `test/**/*.e2e-spec.ts`, config at `test/jest-e2e.json`)
- `npm run format` — prettier on `src/` and `test/`
- `npm run test:cov` — coverage output to `coverage/`
- `npx prisma generate` — regenerate Prisma client after schema changes
- `npx prisma migrate dev` — create and apply a migration (dev)
- `npx prisma migrate deploy` — apply pending migrations (prod)
- `npx prisma db seed` — run seed script (system roles, permissions, superadmin)

Run a single test: `npx jest src/path/to/file.spec.ts`
Run a single e2e test: `npx jest --config ./test/jest-e2e.json test/app.e2e-spec.ts`

No typecheck script; use `npx tsc --noEmit`.

## Key facts

- NestJS v11, Express adapter, **modular monolith** (not microservices)
- TypeScript with `module: "nodenext"`, target `ES2023`, `noImplicitAny: false`, `strictNullChecks: true`
- ESLint uses `projectService: true` (type-aware linting) — typecheck errors can surface as lint errors
- ESLint rule overrides: `@typescript-eslint/no-explicit-any` is off, `no-floating-promises` and `no-unsafe-*` are warn
- Prettier: single quotes, trailing commas (`.prettierrc`)
- All imports use `.js` extensions (required by `nodenext` module resolution)
- Jest v30 (both unit and e2e), ts-jest for transform
- In-process events via `@nestjs/event-emitter` (EventEmitter2) — no external message broker

## Project direction

This is `main-core-service` — the central identity & platform hub for all business apps (pharmacy, warehouse, market, transactions). It handles:

- **Authentication** — login, register, OAuth (Google), JWT, password management
- **User management** — profiles, CRUD, avatars
- **IAM** — fine-grained RBAC with roles, permissions, resource-level access per organization per application
- **Organizations** — multi-tenant boundaries, membership management
- **Applications** — register downstream business apps, OAuth2 client credentials
- **Notifications** — email (SMTP) + WebSocket push (Socket.IO)
- **Storage** — MinIO (S3-compatible) file/image management
- **Audit** — immutable event logging

Downstream services validate JWTs locally (ES256 public key) and optionally call this service's API for permission checks.

## Architecture

```
src/
  main.ts                          # Bootstrap, helmet, CORS, Winston, global prefix, Swagger, Socket.IO
  app.module.ts                    # Root module, global guards (Throttler, JWT, Roles, Permissions)
  config/
    env.validation.ts              # class-validator startup validation
    logger.config.ts               # Winston config
  prisma/
    prisma.module.ts               # @Global() PrismaModule
    prisma.service.ts              # PrismaService (OnModuleInit/OnModuleDestroy)
  common/
    decorators/
      current-user.decorator.ts    # @CurrentUser()
      public.decorator.ts          # @Public()
      roles.decorator.ts           # @Roles('admin')
      permissions.decorator.ts     # @Permissions('inventory:write')
    filters/
      all-exceptions.filter.ts     # Global exception handler
    guards/
      jwt-auth.guard.ts            # Validates JWT, respects @Public()
      roles.guard.ts               # Reads roles from JWT payload (zero DB hits)
      permissions.guard.ts         # Resolves roles → permissions via AccessService cache
    interceptors/
      response-transform.interceptor.ts  # Wraps success responses
    interfaces/
      jwt-payload.interface.ts     # JwtUserPayload, JwtServicePayload
      auth-user.interface.ts       # AuthUser, AuthServiceAccount
    pipes/
      parse-uuid.pipe.ts           # UUID validation for path params
    utils/
      pagination.ts                # PaginationDto, PaginatedResult, paginateResult()
  modules/
    auth/                          # Register, login, OAuth, JWT, refresh, passwords, client credentials, org switching
      strategies/                  # local, jwt, google, client-credentials
      dto/                         # register, login, refresh, passwords, client-credentials, switch-org
    users/                         # Profile CRUD, avatar upload, admin user management
      dto/                         # create, update, update-profile
    organizations/                 # Multi-tenant org management, membership (add/update/remove members)
      dto/                         # create, update, add-member
    iam/                           # Roles, permissions, access control
      roles/                       # CRUD, assign/remove permissions
      permissions/                 # CRUD
      access/                      # /iam/check, /iam/my-permissions, /iam/my-organizations (with 5-min cache)
    applications/                  # Downstream app registration, client credentials, secret regeneration
    notifications/                 # Unified notifications
      email/                       # SMTP via nodemailer, HTML templates with {{key}} placeholders
      websocket/                   # Socket.IO gateway (/ws), user/org/app rooms
    storage/                       # MinIO upload/download, presigned URLs
    audit/                         # Query audit logs with filters (POSTPONED — emissions disabled)
    health/                        # DB + MinIO health checks via @nestjs/terminus
```

## Database schema (PostgreSQL via Prisma v6)

- **User** — id (UUID), email (unique), password, firstName?, lastName?, avatarUrl?, phone?, isActive, timestamps
- **Organization** — id (UUID), name, slug (unique per application), logoUrl?, applicationId? (FK, null=global), isActive, timestamps
- **Application** — id (UUID), name (unique), displayName, description?, clientId (unique), clientSecret (bcrypt-hashed), redirectUris?, isActive, timestamps
- **Role** — id (UUID), name, displayName, description?, isSystem, applicationId? (FK, null=global), timestamps
- **Permission** — id (UUID), name (unique), displayName, module, action, description?, applicationId? (FK, null=global), createdAt
- **RolePermission** — id (UUID), roleId (FK), permissionId (FK), unique on [roleId, permissionId]
- **UserRole** — id (UUID), userId (FK), roleId (FK), organizationId (FK), unique on [userId, roleId, organizationId]
- **RefreshToken** — id (UUID), userId (FK), token (unique), organizationId?, applicationId?, expiresAt, isUsed, createdAt
- **PasswordReset** — id (UUID), userId (FK), token (unique, bcrypt-hashed), expiresAt, usedAt?, createdAt
- **AuditLog** — id (UUID), userId?, applicationId?, action, resource?, ipAddress?, userAgent?, metadata (Json), organizationId?, createdAt

No enums on User (roles via UserRole junction). Soft deletes via `isActive` on User and Organization.

## Route Map

All routes under global prefix `/api/v1`.

### Auth (`/api/v1/auth`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/register` | Public | Register — auto-creates org (optionally scoped to applicationId), assigns org_admin role |
| POST | `/login` | Public + LocalAuthGuard | Login (accepts optional applicationId), returns accessToken + refreshToken |
| GET | `/google` | Public + GoogleAuthGuard | Google OAuth redirect |
| GET | `/google/callback` | Public + GoogleAuthGuard | Google OAuth callback |
| GET | `/verify-token` | JWT | Validates token, returns user |
| POST | `/refresh-token` | Public | Refresh token (rotation: old token invalidated) |
| POST | `/set-password` | JWT | Set password for OAuth users |
| POST | `/change-password` | JWT | Change password (requires current password) |
| POST | `/forgot-password` | Public | Send reset email |
| POST | `/reset-password` | Public | Reset password via token |
| POST | `/token` | Public | OAuth2 client credentials grant |
| POST | `/switch-organization` | JWT | Switch org context (derives applicationId from target org), get new JWT |
| POST | `/logout` | JWT | Invalidate refresh token |

### Users (`/api/v1/users`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/me` | JWT | Current user profile + roles + org memberships |
| PATCH | `/me` | JWT | Update own profile |
| GET | `/` | `users:read` | List users (paginated, filterable by organizationId, applicationId) |
| GET | `/:id` | `users:read` | Get user by ID |
| POST | `/` | `users:write` | Create user |
| PATCH | `/:id` | `users:write` | Update user |
| PATCH | `/:id/status` | `users:write` | Activate/deactivate user |

### Organizations (`/api/v1/organizations`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/` | Public | List organizations (filterable by applicationId) |
| GET | `/:id` | Public | Get organization |
| GET | `/slug/:slug` | Public | Get organization by slug (+ optional applicationId query param) |
| POST | `/` | `organizations:write` | Create organization (optionally scoped to applicationId) |
| PATCH | `/:id` | `organizations:write` | Update organization |
| PATCH | `/:id/status` | `organizations:write` | Activate/deactivate |
| GET | `/:id/members` | `organizations:read` | List org members with roles |
| POST | `/:id/members` | `organizations:write` | Add user to org with role |
| PATCH | `/:id/members/:userId` | `organizations:write` | Update member role |
| DELETE | `/:id/members/:userId` | `organizations:write` | Remove member from org |

### IAM — Roles (`/api/v1/roles`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/` | `roles:read` | List roles (filterable by applicationId) |
| GET | `/:id` | `roles:read` | Get role with permissions |
| POST | `/` | `roles:write` | Create role |
| PATCH | `/:id` | `roles:write` | Update role |
| DELETE | `/:id` | `roles:delete` | Delete role (not system roles) |
| POST | `/:id/permissions` | `roles:write` | Assign permissions to role |
| DELETE | `/:id/permissions/:permissionId` | `roles:write` | Remove permission from role |

### IAM — Permissions (`/api/v1/permissions`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/` | `permissions:read` | List (filterable by applicationId, module) |
| GET | `/:id` | `permissions:read` | Get permission |
| POST | `/` | `permissions:write` | Create permission |
| DELETE | `/:id` | `permissions:delete` | Delete permission |

### IAM — Access (`/api/v1/iam`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/check` | JWT | Check permission (`?permission=...&organizationId=...&applicationId=...`) |
| GET | `/my-permissions` | JWT | All permissions for current user in current org + app context |
| GET | `/my-organizations` | JWT | Organizations the current user belongs to (filterable by applicationId) |

### Applications (`/api/v1/applications`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/` | `applications:read` | List registered apps |
| GET | `/:id` | `applications:read` | Get app details |
| POST | `/` | `applications:write` | Register app (returns plain-text clientSecret once) |
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

## Request processing pipeline

1. Helmet (security headers)
2. CORS (explicit origins from `CORS_ORIGINS` env)
3. Winston logger (replaces NestJS default)
4. Global prefix `/api/v1`
5. Global `ValidationPipe` — whitelist, transform, enableImplicitConversion
6. Global guards: ThrottlerGuard → JwtAuthGuard (respects `@Public()`) → RolesGuard → PermissionsGuard (checks `@Permissions()`)
7. `AllExceptionsFilter` — normalizes errors
8. `ResponseTransformInterceptor` — wraps success responses

## Authentication

- **Login**: Local strategy validates email/password, checks `isActive`, resolves roles for organization, issues JWT. Accepts optional `applicationId` to scope the session to a specific app — resolves the user's first org within that app.
- **Account lockout**: 5 consecutive failed logins → 15-minute lock on same email
- **Google OAuth**: passport-google-oauth20 — no hardcoded org, OAuth users prompted to join/create org. Falls back gracefully when `GOOGLE_CLIENT_ID` is not set.
- **JWT**: passport-jwt verifies Bearer token using ES256 public key; `JwtStrategy.validate()` returns the decoded payload directly
- **RolesGuard**: reads roles from JWT payload (zero DB hits)
- **PermissionsGuard**: reads permissions from JWT payload directly (zero DB hits for permission checks)
- **Client credentials**: OAuth2 flow for service-to-service auth — validates clientId + bcrypt-hashed clientSecret
- **Refresh**: rotation pattern — old refresh token invalidated, new pair issued, replay detection (revokes all sessions on reuse). Refresh tokens store `organizationId` + `applicationId` to maintain session context across refreshes.
- **Organization switching**: validates membership, derives `applicationId` from target org, issues new JWT with different org + app context
- **Token payload (user)**: `{ sub, email, type: "user", organizationId, applicationId?, roles: string[], permissions: string[], iat, exp }` — signed with ES256 private key
- **Token payload (service)**: `{ sub: appName, type: "service", applicationId, permissions, iat, exp }` — signed with ES256 private key
- **Token signing**: ES256 asymmetric (ECDSA P-256). Private key signs, public key verifies. PEM keys stored as single-line `\n`-escaped strings in env vars.

## Application-scoped organizations

Organizations can optionally belong to a specific `Application` via `applicationId` (nullable FK). When `null`, the org is global (not tied to any app). This enables multi-app scenarios where a single user has separate organizations per downstream app (e.g., Laundry Serpong, Warehouse Bogor, Shop Maju).

Key behaviors:
- **Login with applicationId**: `POST /auth/login` accepts optional `applicationId`. The auth service finds the user's first org in that app and scopes the JWT accordingly.
- **Register with applicationId**: `POST /auth/register` accepts optional `applicationId`. The auto-created org belongs to that app.
- **Claims resolution**: `resolveUserClaims()` filters roles by `applicationId` — global roles (`null`) are always included; app-scoped roles only appear when the session's `applicationId` matches.
- **Slug uniqueness**: `@@unique([slug, applicationId])` — the same slug can exist in different apps (e.g., "bogor" in both Laundry and Warehouse apps).
- **Role-app consistency**: When adding a member to an app-scoped org, the assigned role must be either global (`applicationId: null`) or belong to the same app.
- **AccessService cache**: Cache key includes `applicationId` (`${userId}:${orgId}:${appId ?? 'global'}:${roles}`) to avoid cross-app permission leaks.
- **WebSocket**: Clients with `applicationId` in their JWT auto-join `app:${applicationId}` room for app-wide notifications.

## Environment variables

| Variable | Required | Default |
|----------|----------|---------|
| `DATABASE_URL` | Yes | — |
| `JWT_PRIVATE_KEY` | Yes | — | ES256 private key (PEM, `\n`-escaped) for signing tokens |
| `JWT_PUBLIC_KEY` | Yes | — | ES256 public key (PEM, `\n`-escaped) for verifying tokens |
| `JWT_ACCESS_EXPIRATION` | No | `900` (seconds, 15 min) |
| `JWT_REFRESH_EXPIRATION` | No | `604800` (seconds, 7 days) |
| `GOOGLE_CLIENT_ID` | No | — | Set to enable Google OAuth |
| `GOOGLE_CLIENT_SECRET` | No | — |
| `GOOGLE_CALLBACK_URL` | No | `http://localhost:3000/api/v1/auth/google/callback` |
| `SMTP_HOST` | No | `localhost` |
| `SMTP_PORT` | No | `587` |
| `SMTP_USER` | No | `''` |
| `SMTP_PASS` | No | `''` |
| `SMTP_FROM` | No | `noreply@example.com` |
| `FRONTEND_URL` | No | `http://localhost:5173` |
| `CORS_ORIGINS` | No | `http://localhost:5173` | Comma-separated list of allowed origins |
| `MINIO_ENDPOINT` | No | `localhost` |
| `MINIO_PORT` | No | `9000` |
| `MINIO_ACCESS_KEY` | No | `minioadmin` |
| `MINIO_SECRET_KEY` | No | `minioadmin` |
| `MINIO_BUCKET` | No | `main-core` |
| `MINIO_USE_SSL` | No | `false` |

## Module pattern

All business modules follow a 3-layer pattern:

- **Controller** — HTTP handling, decorators (`@ApiTags`, `@Permissions`, `@Public`)
- **Service** — business logic, delegates to repository, emits events
- **Repository** — direct Prisma queries, throws `NotFoundException` on missing entities
- **DTOs** — Create DTO with `class-validator` + Swagger decorators; Update DTO via `PartialType(CreateDto)`

Modules communicate via `EventEmitter2` (in-process). Never import another module's repository directly.

## Code conventions

- Password fields are destructured out before returning user objects
- Update methods cast DTOs to `{ [key: string]: unknown }` before passing to repository
- All Swagger DTOs use `@ApiProperty`/`@ApiPropertyOptional` with example values
- Swagger UI at `/docs` (no global prefix), bearer auth configured
- Email templates are HTML files with `{{key}}` placeholders in `src/modules/notifications/email/templates/`
- JWT expiration uses raw **seconds** as integers — no string parsing
- Path params with UUID use `ParseUUIDPipe`
- Pagination via `page`/`limit` query params with default `limit: 20`
- Per-endpoint rate limiting via `@Throttle()` on auth endpoints

## Postponed features

### Audit logging (postponed — storage constraint)

The audit module (`src/modules/audit/`) is fully built (schema, repository, service, controller) but **all `audit.log` event emissions are commented out** to avoid DB storage growth on the current server.

All commented-out lines follow this pattern:
```typescript
// TODO: audit.log - postponed (see AGENTS.md)
```

When storage is available, re-enable by:
1. Uncommenting all `// TODO: audit.log` lines across services (search the codebase for the pattern)
2. Re-adding `EventEmitter2` injection where it was removed (users, roles, permissions, applications, organizations services)
3. Consider refactoring to use a **decorator + interceptor** pattern instead of manual emissions:
   ```typescript
   @Auditable('user.deleted')  // auto-extracts userId, ip, userAgent from request
   @Delete(':id')
   remove(@Param('id') id: string) { ... }
   ```
4. Add a scheduled task to archive logs older than 90 days to cold storage

### Shared auth library (@main-core/auth-client)

npm package for downstream services with guards, types, and API client. To be built when there are downstream services to integrate.

---

## API Contracts — Detailed

All endpoints are under global prefix `/api/v1`.

**Response wrapper:** All success responses are wrapped in:

```json
{
  "statusCode": 200,
  "message": "Success",
  "data": "<T>",
  "timestamp": "2026-04-27T00:00:00.000Z",
  "path": "/api/v1/<resource>"
}
```

**Common error format:**

```json
{
  "statusCode": 404,
  "message": "Resource not found",
  "error": "Not Found"
}
```

| Status | When |
|--------|------|
| `401` | Missing or invalid JWT |
| `403` | Missing required permission |
| `404` | Resource not found |
| `400` | Validation error |
| `429` | Rate limited |

---

### Auth API Contract (`/api/v1/auth`)

#### 1. `POST /api/v1/auth/register` — Register new user

- **Auth:** Public
- **Rate limit:** 3 requests / 60 seconds

**Request Body:**

```json
{
  "email": "john@example.com",
  "password": "Str0ng!Pass1",
  "firstName": "John",
  "lastName": "Doe",
  "applicationId": "uuid-of-application"
}
```

| Field | Type | Required | Validation | Description |
|-------|------|----------|------------|-------------|
| `email` | `string` | **Yes** | Valid email | Must be unique |
| `password` | `string` | **Yes** | Min 8 chars, must contain uppercase, lowercase, and number | — |
| `firstName` | `string` | No | — | — |
| `lastName` | `string` | No | — | — |
| `applicationId` | `string (UUID)` | No | Valid UUID | Scope org to a specific app |

**Response `data`:**

```json
{
  "accessToken": "eyJhbGciOiJFUzI1NiJ9...",
  "refreshToken": "a1b2c3d4...",
  "user": {
    "id": "uuid",
    "email": "john@example.com",
    "firstName": "John",
    "lastName": "Doe",
    "avatarUrl": null,
    "phone": null,
    "isActive": true,
    "createdAt": "2026-04-27T00:00:00.000Z",
    "updatedAt": "2026-04-27T00:00:00.000Z"
  },
  "organization": {
    "id": "uuid-org",
    "name": "Organization of John",
    "slug": "org-a1b2c3d4",
    "logoUrl": null,
    "applicationId": null,
    "isActive": true,
    "createdAt": "2026-04-27T00:00:00.000Z",
    "updatedAt": "2026-04-27T00:00:00.000Z"
  }
}
```

**Error cases:**
- `400` — Email already in use
- `400` — Invalid or inactive application

---

#### 2. `POST /api/v1/auth/login` — Login

- **Auth:** Public (validated via LocalAuthGuard)
- **Rate limit:** 5 requests / 60 seconds
- **Account lockout:** 5 failed attempts → 15 min lock

**Request Body:**

```json
{
  "email": "john@example.com",
  "password": "Str0ng!Pass1",
  "applicationId": "uuid-of-application"
}
```

| Field | Type | Required | Validation | Description |
|-------|------|----------|------------|-------------|
| `email` | `string` | **Yes** | Valid email | — |
| `password` | `string` | **Yes** | Non-empty | — |
| `applicationId` | `string (UUID)` | No | Valid UUID | Scope session to app; resolves user's first org in that app |

**Response `data`:**

```json
{
  "accessToken": "eyJhbGciOiJFUzI1NiJ9...",
  "refreshToken": "a1b2c3d4..."
}
```

**Error cases:**
- `401` — Invalid credentials or account locked
- `400` — No organization in the specified application

---

#### 3. `GET /api/v1/auth/google` — Google OAuth redirect

- **Auth:** Public
- **Request:** No body, no params. Redirects to Google consent screen.

---

#### 4. `GET /api/v1/auth/google/callback` — Google OAuth callback

- **Auth:** Public (GoogleAuthGuard)
- **Request:** No body. Handled by Google OAuth redirect.
- **Response:** Redirects to `{FRONTEND_URL}/auth/google/callback?accessToken=...&refreshToken=...`

---

#### 5. `GET /api/v1/auth/verify-token` — Validate current token

- **Auth:** JWT required

**Response `data`:**

```json
{
  "valid": true,
  "user": {
    "sub": "uuid",
    "email": "john@example.com",
    "type": "user",
    "organizationId": "uuid-org",
    "applicationId": null,
    "roles": ["org_admin"],
    "permissions": ["users:read", "users:write"],
    "iat": 1742700000,
    "exp": 1742700900
  }
}
```

---

#### 6. `POST /api/v1/auth/refresh-token` — Refresh tokens

- **Auth:** Public

**Request Body:**

```json
{
  "refreshToken": "a1b2c3d4..."
}
```

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| `refreshToken` | `string` | **Yes** | Non-empty |

**Response `data`:**

```json
{
  "accessToken": "eyJhbGciOiJFUzI1NiJ9...",
  "refreshToken": "new-token..."
}
```

> Old refresh token is invalidated (rotation). Reuse of old token revokes ALL sessions.

**Error cases:**
- `401` — Invalid, expired, or reused refresh token

---

#### 7. `POST /api/v1/auth/set-password` — Set password (OAuth users)

- **Auth:** JWT required

**Request Body:**

```json
{
  "newPassword": "Str0ng!Pass1"
}
```

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| `newPassword` | `string` | **Yes** | Min 8 chars, must contain uppercase, lowercase, and number |

**Response `data`:**

```json
{
  "message": "Password set successfully"
}
```

**Error cases:**
- `400` — Password already set. Use change password instead.

---

#### 8. `POST /api/v1/auth/change-password` — Change password

- **Auth:** JWT required

**Request Body:**

```json
{
  "currentPassword": "currentPassword123",
  "newPassword": "Str0ng!Pass1"
}
```

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| `currentPassword` | `string` | **Yes** | Non-empty |
| `newPassword` | `string` | **Yes** | Min 8 chars, must contain uppercase, lowercase, and number |

**Response `data`:**

```json
{
  "message": "Password changed successfully"
}
```

**Error cases:**
- `400` — No password set. Use set password instead.
- `401` — Current password is incorrect

---

#### 9. `POST /api/v1/auth/forgot-password` — Request password reset

- **Auth:** Public
- **Rate limit:** 3 requests / 60 seconds

**Request Body:**

```json
{
  "email": "john@example.com"
}
```

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| `email` | `string` | **Yes** | Valid email |

**Response `data`:**

```json
{
  "message": "If the email exists, a reset link will be sent"
}
```

> Always returns the same message to prevent email enumeration. Reset link valid for 1 hour.

---

#### 10. `POST /api/v1/auth/reset-password` — Reset password via token

- **Auth:** Public

**Request Body:**

```json
{
  "token": "reset-token-value",
  "newPassword": "Str0ng!Pass1",
  "email": "john@example.com"
}
```

| Field | Type | Required | Validation | Description |
|-------|------|----------|------------|-------------|
| `token` | `string` | **Yes** | Non-empty | Reset token from email |
| `newPassword` | `string` | **Yes** | Min 8 chars, must contain uppercase, lowercase, and number | — |
| `email` | `string` | No | Valid email | Helps locate the user account |

**Response `data`:**

```json
{
  "message": "Password reset successfully"
}
```

> All refresh tokens for the user are invalidated after reset.

**Error cases:**
- `401` — Invalid or expired reset token

---

#### 11. `POST /api/v1/auth/token` — OAuth2 client credentials grant

- **Auth:** Public

**Request Body:**

```json
{
  "grantType": "client_credentials",
  "clientId": "uuid-client-id",
  "clientSecret": "plain-text-secret"
}
```

| Field | Type | Required | Validation | Description |
|-------|------|----------|------------|-------------|
| `grantType` | `string` | No | — | Usually `client_credentials` |
| `clientId` | `string` | **Yes** | Non-empty | Application's clientId |
| `clientSecret` | `string` | **Yes** | Non-empty | Application's plain-text secret |

**Response `data`:**

```json
{
  "accessToken": "eyJhbGciOiJFUzI1NiJ9...",
  "tokenType": "Bearer",
  "expiresIn": 900
}
```

> The service token payload: `{ sub: appName, type: "service", applicationId, permissions, iat, exp }`

**Error cases:**
- `401` — Invalid client credentials

---

#### 12. `POST /api/v1/auth/switch-organization` — Switch org context

- **Auth:** JWT required

**Request Body:**

```json
{
  "organizationId": "uuid-of-organization"
}
```

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| `organizationId` | `string (UUID)` | **Yes** | Valid UUID, non-empty |

**Response `data`:**

```json
{
  "accessToken": "eyJhbGciOiJFUzI1NiJ9...",
  "refreshToken": "new-token..."
}
```

> New JWT derives `applicationId` from the target org. Roles/permissions are re-resolved for the new org+app context.

**Error cases:**
- `400` — Not a member of this organization
- `400` — Organization not found

---

#### 13. `POST /api/v1/auth/logout` — Logout

- **Auth:** JWT required

**Request Body:**

```json
{
  "refreshToken": "a1b2c3d4..."
}
```

| Field | Type | Required | Validation | Description |
|-------|------|----------|------------|-------------|
| `refreshToken` | `string` | No | — | If provided, invalidates only this session. If omitted, invalidates ALL refresh tokens for the user. |

**Response `data`:**

```json
{
  "message": "Logged out successfully"
}
```

---

### Users API Contract (`/api/v1/users`)

**Auth:** All endpoints require `Authorization: Bearer <token>` header.

---

#### 1. `GET /api/v1/users/me` — Get current user profile

- **Auth:** JWT required
- **Permission:** None (any authenticated user)
- **Request:** No body, no query params.

**Response `data`:**

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "email": "john@example.com",
  "firstName": "John",
  "lastName": "Doe",
  "avatarUrl": null,
  "phone": "+1234567890",
  "isActive": true,
  "createdAt": "2026-01-01T00:00:00.000Z",
  "updatedAt": "2026-01-15T00:00:00.000Z",
  "organizations": [
    {
      "organization": {
        "id": "uuid-org",
        "name": "Acme Corp",
        "slug": "acme-corp",
        "logoUrl": null,
        "isActive": true,
        "applicationId": null
      },
      "role": {
        "id": "uuid-role",
        "name": "org_admin",
        "displayName": "Organization Admin"
      }
    }
  ]
}
```

---

#### 2. `PATCH /api/v1/users/me` — Update own profile

- **Auth:** JWT required
- **Permission:** None (any authenticated user)

**Request Body:**

```json
{
  "firstName": "John",
  "lastName": "Doe",
  "phone": "+1234567890"
}
```

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| `firstName` | `string` | No | — |
| `lastName` | `string` | No | — |
| `phone` | `string` | No | — |

All fields are optional. Cannot update `email`, `password`, `isActive`, or `avatarUrl` via this endpoint.

**Response `data`:**

```json
{
  "id": "uuid",
  "email": "john@example.com",
  "firstName": "John",
  "lastName": "Doe",
  "avatarUrl": null,
  "phone": "+1234567890",
  "isActive": true,
  "createdAt": "2026-01-01T00:00:00.000Z",
  "updatedAt": "2026-04-27T00:00:00.000Z"
}
```

---

#### 3. `GET /api/v1/users` — List users (paginated)

- **Auth:** JWT required
- **Permission:** `users:read`

**Query Parameters:**

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `page` | `integer` | No | `1` | Page number (min 1) |
| `limit` | `integer` | No | `20` | Items per page (min 1) |
| `organizationId` | `string (UUID)` | No | — | Filter by organization |
| `applicationId` | `string (UUID)` | No | — | Filter by application (ignored if `organizationId` is also provided) |

**Example:** `GET /api/v1/users?page=2&limit=10&organizationId=uuid-org`

**Response `data`:**

```json
{
  "data": [
    {
      "id": "uuid",
      "email": "john@example.com",
      "firstName": "John",
      "lastName": "Doe",
      "avatarUrl": null,
      "phone": "+1234567890",
      "isActive": true,
      "createdAt": "2026-01-01T00:00:00.000Z",
      "updatedAt": "2026-01-01T00:00:00.000Z"
    }
  ],
  "meta": {
    "page": 2,
    "limit": 10,
    "total": 45,
    "totalPages": 5
  }
}
```

> Note: The response wrapper's `data` field contains this object, so users array is at `response.data.data[]` and pagination at `response.data.meta`.

---

#### 4. `GET /api/v1/users/:id` — Get user by ID

- **Auth:** JWT required
- **Permission:** `users:read`

**Path Parameters:**

| Param | Type | Required | Validation |
|-------|------|----------|------------|
| `id` | `string (UUID)` | Yes | Must be valid UUID |

**Example:** `GET /api/v1/users/550e8400-e29b-41d4-a716-446655440000`

**Response `data`:**

```json
{
  "id": "uuid",
  "email": "john@example.com",
  "firstName": "John",
  "lastName": "Doe",
  "avatarUrl": null,
  "phone": "+1234567890",
  "isActive": true,
  "createdAt": "2026-01-01T00:00:00.000Z",
  "updatedAt": "2026-01-01T00:00:00.000Z",
  "organizations": [
    {
      "organization": {
        "id": "uuid-org",
        "name": "Acme Corp",
        "slug": "acme-corp",
        "logoUrl": null,
        "isActive": true,
        "applicationId": null
      },
      "role": {
        "id": "uuid-role",
        "name": "org_admin",
        "displayName": "Organization Admin"
      }
    }
  ]
}
```

---

#### 5. `POST /api/v1/users` — Create user (admin)

- **Auth:** JWT required
- **Permission:** `users:write`

**Request Body:**

```json
{
  "email": "john@example.com",
  "password": "Str0ng!Pass1",
  "firstName": "John",
  "lastName": "Doe",
  "phone": "+1234567890",
  "organizationId": "550e8400-e29b-41d4-a716-446655440000"
}
```

| Field | Type | Required | Validation | Description |
|-------|------|----------|------------|-------------|
| `email` | `string` | **Yes** | Valid email, must be unique | User's email address |
| `password` | `string` | **Yes** | Min 8 chars, must contain uppercase, lowercase, and number | Plaintext password (hashed server-side) |
| `firstName` | `string` | No | — | — |
| `lastName` | `string` | No | — | — |
| `phone` | `string` | No | — | — |
| `organizationId` | `string (UUID)` | No | Valid UUID if provided | Org to auto-assign user to. Defaults to admin's current org from JWT. User gets the lowest-permission role in that org. |

**Response `data`:**

```json
{
  "id": "uuid-new-user",
  "email": "john@example.com",
  "firstName": "John",
  "lastName": "Doe",
  "avatarUrl": null,
  "phone": "+1234567890",
  "isActive": true,
  "createdAt": "2026-04-27T00:00:00.000Z",
  "updatedAt": "2026-04-27T00:00:00.000Z"
}
```

**Error cases:**
- `400` — Email already in use
- `400` — Organization not found (if `organizationId` is provided but invalid)

---

#### 6. `PATCH /api/v1/users/:id` — Update user (admin)

- **Auth:** JWT required
- **Permission:** `users:write`

**Path Parameters:**

| Param | Type | Required | Validation |
|-------|------|----------|------------|
| `id` | `string (UUID)` | Yes | Must be valid UUID |

**Request Body:** (all fields optional — partial of `CreateUserDto` minus `password`)

```json
{
  "email": "newemail@example.com",
  "firstName": "Jane",
  "lastName": "Smith",
  "phone": "+1987654321",
  "organizationId": "uuid-org"
}
```

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| `email` | `string` | No | Valid email, must be unique |
| `firstName` | `string` | No | — |
| `lastName` | `string` | No | — |
| `phone` | `string` | No | — |
| `organizationId` | `string (UUID)` | No | Valid UUID |

> Note: `password` is **not** updatable via this endpoint.

**Response `data`:**

```json
{
  "id": "uuid",
  "email": "newemail@example.com",
  "firstName": "Jane",
  "lastName": "Smith",
  "avatarUrl": null,
  "phone": "+1987654321",
  "isActive": true,
  "createdAt": "2026-01-01T00:00:00.000Z",
  "updatedAt": "2026-04-27T00:00:00.000Z"
}
```

---

#### 7. `PATCH /api/v1/users/:id/status` — Activate/deactivate user

- **Auth:** JWT required
- **Permission:** `users:write`

**Path Parameters:**

| Param | Type | Required | Validation |
|-------|------|----------|------------|
| `id` | `string (UUID)` | Yes | Must be valid UUID |

**Request Body:**

```json
{
  "isActive": false
}
```

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| `isActive` | `boolean` | **Yes** | `true` or `false` |

**Response `data`:**

```json
{
  "id": "uuid",
  "email": "john@example.com",
  "isActive": false
}
```

---

### Organizations API Contract (`/api/v1/organizations`)

---

#### 1. `GET /api/v1/organizations` — List organizations (paginated)

- **Auth:** Public
- **Permission:** None

**Query Parameters:**

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `page` | `integer` | No | `1` | Page number (min 1) |
| `limit` | `integer` | No | `20` | Items per page (min 1) |
| `applicationId` | `string (UUID)` | No | — | Filter by application |

**Response `data`:**

```json
{
  "data": [
    {
      "id": "uuid",
      "name": "Acme Corp",
      "slug": "acme-corp",
      "logoUrl": null,
      "applicationId": null,
      "isActive": true,
      "createdAt": "2026-01-01T00:00:00.000Z",
      "updatedAt": "2026-01-01T00:00:00.000Z"
    }
  ],
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 10,
    "totalPages": 1
  }
}
```

---

#### 2. `GET /api/v1/organizations/:id` — Get organization

- **Auth:** Public
- **Permission:** None

**Path Parameters:**

| Param | Type | Required | Validation |
|-------|------|----------|------------|
| `id` | `string (UUID)` | Yes | Must be valid UUID |

**Response `data`:**

```json
{
  "id": "uuid",
  "name": "Acme Corp",
  "slug": "acme-corp",
  "logoUrl": null,
  "applicationId": null,
  "isActive": true,
  "createdAt": "2026-01-01T00:00:00.000Z",
  "updatedAt": "2026-01-01T00:00:00.000Z"
}
```

---

#### 3. `GET /api/v1/organizations/slug/:slug` — Get organization by slug

- **Auth:** Public
- **Permission:** None

**Path Parameters:**

| Param | Type | Required | Validation |
|-------|------|----------|------------|
| `slug` | `string` | Yes | — |

**Query Parameters:**

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `applicationId` | `string (UUID)` | No | Disambiguate when same slug exists across apps |

**Example:** `GET /api/v1/organizations/slug/acme-corp?applicationId=uuid-app`

**Response `data`:** Same as GET `/:id`

---

#### 4. `POST /api/v1/organizations` — Create organization

- **Auth:** JWT required
- **Permission:** `organizations:write`

**Request Body:**

```json
{
  "name": "Acme Corporation",
  "slug": "acme-corp",
  "applicationId": "uuid-of-application"
}
```

| Field | Type | Required | Validation | Description |
|-------|------|----------|------------|-------------|
| `name` | `string` | **Yes** | Non-empty | — |
| `slug` | `string` | **Yes** | Non-empty | Unique per application |
| `applicationId` | `string (UUID)` | No | Valid UUID | Scope to app. `null` = global org. |

**Response `data`:**

```json
{
  "id": "uuid",
  "name": "Acme Corporation",
  "slug": "acme-corp",
  "logoUrl": null,
  "applicationId": null,
  "isActive": true,
  "createdAt": "2026-04-27T00:00:00.000Z",
  "updatedAt": "2026-04-27T00:00:00.000Z"
}
```

**Error cases:**
- `400` — Invalid or inactive application

---

#### 5. `PATCH /api/v1/organizations/:id` — Update organization

- **Auth:** JWT required
- **Permission:** `organizations:write`

**Path Parameters:**

| Param | Type | Required | Validation |
|-------|------|----------|------------|
| `id` | `string (UUID)` | Yes | Must be valid UUID |

**Request Body:** (all fields optional)

```json
{
  "name": "New Name",
  "slug": "new-slug",
  "applicationId": "uuid-app"
}
```

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| `name` | `string` | No | Non-empty |
| `slug` | `string` | No | Non-empty |
| `applicationId` | `string (UUID)` | No | Valid UUID |

**Response `data`:** Same shape as create response.

---

#### 6. `PATCH /api/v1/organizations/:id/status` — Activate/deactivate organization

- **Auth:** JWT required
- **Permission:** `organizations:write`

**Path Parameters:**

| Param | Type | Required | Validation |
|-------|------|----------|------------|
| `id` | `string (UUID)` | Yes | Must be valid UUID |

**Request Body:**

```json
{
  "isActive": false
}
```

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| `isActive` | `boolean` | **Yes** | `true` or `false` |

**Response `data`:** Updated organization object.

---

#### 7. `GET /api/v1/organizations/:id/members` — List org members

- **Auth:** JWT required
- **Permission:** `organizations:read`

**Path Parameters:**

| Param | Type | Required | Validation |
|-------|------|----------|------------|
| `id` | `string (UUID)` | Yes | Must be valid UUID |

**Response `data`:**

```json
[
  {
    "id": "uuid-user-role",
    "userId": "uuid-user",
    "roleId": "uuid-role",
    "organizationId": "uuid-org",
    "user": {
      "id": "uuid-user",
      "email": "john@example.com",
      "firstName": "John",
      "lastName": "Doe"
    },
    "role": {
      "id": "uuid-role",
      "name": "org_admin",
      "displayName": "Organization Admin"
    }
  }
]
```

---

#### 8. `POST /api/v1/organizations/:id/members` — Add member to org

- **Auth:** JWT required
- **Permission:** `organizations:write`

**Path Parameters:**

| Param | Type | Required | Validation |
|-------|------|----------|------------|
| `id` | `string (UUID)` | Yes | Must be valid UUID (organization) |

**Request Body:**

```json
{
  "userId": "uuid-of-user",
  "roleId": "uuid-of-role"
}
```

| Field | Type | Required | Validation | Description |
|-------|------|----------|------------|-------------|
| `userId` | `string (UUID)` | **Yes** | Valid UUID | User to add |
| `roleId` | `string (UUID)` | **Yes** | Valid UUID | Role to assign. Must be global or belong to the same app as the org. |

**Response `data`:** Created UserRole object.

**Error cases:**
- `400` — Role does not belong to the same application as this organization

---

#### 9. `PATCH /api/v1/organizations/:id/members/:userId` — Update member role

- **Auth:** JWT required
- **Permission:** `organizations:write`

**Path Parameters:**

| Param | Type | Required | Validation |
|-------|------|----------|------------|
| `id` | `string (UUID)` | Yes | Organization UUID |
| `userId` | `string (UUID)` | Yes | Member user UUID |

**Request Body:**

```json
{
  "roleId": "uuid-of-new-role"
}
```

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| `roleId` | `string (UUID)` | **Yes** | Valid UUID |

**Response `data`:** Updated UserRole object.

---

#### 10. `DELETE /api/v1/organizations/:id/members/:userId` — Remove member from org

- **Auth:** JWT required
- **Permission:** `organizations:write`

**Path Parameters:**

| Param | Type | Required | Validation |
|-------|------|----------|------------|
| `id` | `string (UUID)` | Yes | Organization UUID |
| `userId` | `string (UUID)` | Yes | Member user UUID |

**Request Body:** None.

**Response `data`:** Deleted UserRole object.

---

### Roles API Contract (`/api/v1/roles`)

---

#### 1. `GET /api/v1/roles` — List roles

- **Auth:** JWT required
- **Permission:** `roles:read`

**Query Parameters:**

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `applicationId` | `string (UUID)` | No | Filter by application |

**Response `data`:**

```json
[
  {
    "id": "uuid",
    "name": "org_admin",
    "displayName": "Organization Admin",
    "description": "Full access within organization",
    "isSystem": true,
    "applicationId": null,
    "createdAt": "2026-01-01T00:00:00.000Z",
    "updatedAt": "2026-01-01T00:00:00.000Z"
  }
]
```

---

#### 2. `GET /api/v1/roles/:id` — Get role with permissions

- **Auth:** JWT required
- **Permission:** `roles:read`

**Path Parameters:**

| Param | Type | Required | Validation |
|-------|------|----------|------------|
| `id` | `string (UUID)` | Yes | Must be valid UUID |

**Response `data`:**

```json
{
  "id": "uuid",
  "name": "org_admin",
  "displayName": "Organization Admin",
  "description": "Full access within organization",
  "isSystem": true,
  "applicationId": null,
  "createdAt": "2026-01-01T00:00:00.000Z",
  "updatedAt": "2026-01-01T00:00:00.000Z",
  "permissions": [
    {
      "id": "uuid",
      "name": "users:read",
      "displayName": "Read Users",
      "module": "users",
      "action": "read",
      "description": null,
      "applicationId": null,
      "createdAt": "2026-01-01T00:00:00.000Z"
    }
  ]
}
```

---

#### 3. `POST /api/v1/roles` — Create role

- **Auth:** JWT required
- **Permission:** `roles:write`

**Request Body:**

```json
{
  "name": "pharmacist",
  "displayName": "Pharmacist",
  "description": "Handles pharmacy operations",
  "applicationId": "uuid-of-application"
}
```

| Field | Type | Required | Validation | Description |
|-------|------|----------|------------|-------------|
| `name` | `string` | **Yes** | Non-empty | Must be unique per application scope |
| `displayName` | `string` | **Yes** | Non-empty | — |
| `description` | `string` | No | — | — |
| `applicationId` | `string (UUID)` | No | Valid UUID | Scope to app. `null` = global role. |

**Response `data`:** Created role object.

**Error cases:**
- `400` — Role name already exists

---

#### 4. `PATCH /api/v1/roles/:id` — Update role

- **Auth:** JWT required
- **Permission:** `roles:write`

**Path Parameters:**

| Param | Type | Required | Validation |
|-------|------|----------|------------|
| `id` | `string (UUID)` | Yes | Must be valid UUID |

**Request Body:** (all fields optional)

```json
{
  "name": "senior-pharmacist",
  "displayName": "Senior Pharmacist",
  "description": "Senior pharmacy staff",
  "applicationId": "uuid-app"
}
```

**Response `data`:** Updated role object.

---

#### 5. `DELETE /api/v1/roles/:id` — Delete role

- **Auth:** JWT required
- **Permission:** `roles:delete`

**Path Parameters:**

| Param | Type | Required | Validation |
|-------|------|----------|------------|
| `id` | `string (UUID)` | Yes | Must be valid UUID |

**Request Body:** None.

**Response `data`:** Deleted role object.

**Error cases:**
- `400` — Cannot delete system roles

---

#### 6. `POST /api/v1/roles/:id/permissions` — Assign permissions to role

- **Auth:** JWT required
- **Permission:** `roles:write`

**Path Parameters:**

| Param | Type | Required | Validation |
|-------|------|----------|------------|
| `id` | `string (UUID)` | Yes | Role UUID |

**Request Body:**

```json
{
  "permissionIds": ["uuid-1", "uuid-2"]
}
```

| Field | Type | Required | Validation | Description |
|-------|------|----------|------------|-------------|
| `permissionIds` | `string[]` | **Yes** | Array of valid UUIDs | Permission IDs to assign |

**Response `data`:** Role with updated permissions (same shape as GET `/:id`).

---

#### 7. `DELETE /api/v1/roles/:id/permissions/:permissionId` — Remove permission from role

- **Auth:** JWT required
- **Permission:** `roles:write`

**Path Parameters:**

| Param | Type | Required | Validation |
|-------|------|----------|------------|
| `id` | `string (UUID)` | Yes | Role UUID |
| `permissionId` | `string (UUID)` | Yes | Permission UUID |

**Request Body:** None.

**Response `data`:** Role with updated permissions (same shape as GET `/:id`).

---

### Permissions API Contract (`/api/v1/permissions`)

---

#### 1. `GET /api/v1/permissions` — List permissions

- **Auth:** JWT required
- **Permission:** `permissions:read`

**Query Parameters:**

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `applicationId` | `string (UUID)` | No | Filter by application |
| `module` | `string` | No | Filter by module name |

**Response `data`:**

```json
[
  {
    "id": "uuid",
    "name": "users:read",
    "displayName": "Read Users",
    "module": "users",
    "action": "read",
    "description": null,
    "applicationId": null,
    "createdAt": "2026-01-01T00:00:00.000Z"
  }
]
```

---

#### 2. `GET /api/v1/permissions/:id` — Get permission

- **Auth:** JWT required
- **Permission:** `permissions:read`

**Path Parameters:**

| Param | Type | Required | Validation |
|-------|------|----------|------------|
| `id` | `string (UUID)` | Yes | Must be valid UUID |

**Response `data`:** Single permission object (same shape as list item).

---

#### 3. `POST /api/v1/permissions` — Create permission

- **Auth:** JWT required
- **Permission:** `permissions:write`

**Request Body:**

```json
{
  "name": "inventory:write",
  "displayName": "Create/Edit Inventory",
  "module": "inventory",
  "action": "write",
  "description": "Create and edit inventory items",
  "applicationId": "uuid-of-application"
}
```

| Field | Type | Required | Validation | Description |
|-------|------|----------|------------|-------------|
| `name` | `string` | **Yes** | Non-empty, must be unique | Format: `module:action` |
| `displayName` | `string` | **Yes** | Non-empty | — |
| `module` | `string` | **Yes** | Non-empty | — |
| `action` | `string` | **Yes** | Non-empty | — |
| `description` | `string` | No | — | — |
| `applicationId` | `string (UUID)` | No | Valid UUID | Scope to app. `null` = global. |

**Response `data`:** Created permission object.

**Error cases:**
- `400` — Permission name already exists

---

#### 4. `DELETE /api/v1/permissions/:id` — Delete permission

- **Auth:** JWT required
- **Permission:** `permissions:delete`

**Path Parameters:**

| Param | Type | Required | Validation |
|-------|------|----------|------------|
| `id` | `string (UUID)` | Yes | Must be valid UUID |

**Request Body:** None.

**Response `data`:** Deleted permission object.

---

### IAM — Access API Contract (`/api/v1/iam`)

---

#### 1. `GET /api/v1/iam/check` — Check if user has permission

- **Auth:** JWT required

**Query Parameters:**

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `permission` | `string` | **Yes** | Permission name to check (e.g. `users:read`) |
| `organizationId` | `string (UUID)` | No | Defaults to JWT's `organizationId` |
| `applicationId` | `string (UUID)` | No | Defaults to JWT's `applicationId` |

**Example:** `GET /api/v1/iam/check?permission=users:read&organizationId=uuid-org`

**Response `data`:**

```json
{
  "permission": "users:read",
  "authorized": true
}
```

---

#### 2. `GET /api/v1/iam/my-permissions` — Get all permissions for current context

- **Auth:** JWT required

**Request:** No body, no query params. Uses JWT's `organizationId` and `applicationId`.

**Response `data`:**

```json
{
  "permissions": ["users:read", "users:write", "roles:read"]
}
```

---

#### 3. `GET /api/v1/iam/my-organizations` — Get user's organizations

- **Auth:** JWT required

**Query Parameters:**

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `applicationId` | `string (UUID)` | No | Filter to organizations within a specific app |

**Response `data`:**

```json
[
  {
    "id": "uuid-org",
    "name": "Acme Corp",
    "slug": "acme-corp",
    "applicationId": null,
    "roles": ["org_admin"]
  }
]
```

---

### Applications API Contract (`/api/v1/applications`)

---

#### 1. `GET /api/v1/applications` — List applications

- **Auth:** JWT required
- **Permission:** `applications:read`

**Request:** No body, no query params.

**Response `data`:**

```json
[
  {
    "id": "uuid",
    "name": "pharmacy",
    "displayName": "Pharmacy App",
    "description": "Pharmacy management application",
    "clientId": "uuid-client-id",
    "redirectUris": "[\"http://localhost:3000/callback\"]",
    "isActive": true,
    "createdAt": "2026-01-01T00:00:00.000Z",
    "updatedAt": "2026-01-01T00:00:00.000Z"
  }
]
```

> Note: `clientSecret` is never returned in list/detail responses.

---

#### 2. `GET /api/v1/applications/:id` — Get application details

- **Auth:** JWT required
- **Permission:** `applications:read`

**Path Parameters:**

| Param | Type | Required | Validation |
|-------|------|----------|------------|
| `id` | `string (UUID)` | Yes | Must be valid UUID |

**Response `data`:** Single application object (same shape as list item, no `clientSecret`).

---

#### 3. `POST /api/v1/applications` — Register application

- **Auth:** JWT required
- **Permission:** `applications:write`

**Request Body:**

```json
{
  "name": "pharmacy",
  "displayName": "Pharmacy App",
  "description": "Pharmacy management application",
  "redirectUris": ["http://localhost:3000/callback"]
}
```

| Field | Type | Required | Validation | Description |
|-------|------|----------|------------|-------------|
| `name` | `string` | **Yes** | Non-empty, must be unique | Internal identifier |
| `displayName` | `string` | **Yes** | Non-empty | Human-readable name |
| `description` | `string` | No | — | — |
| `redirectUris` | `string[]` | No | — | OAuth redirect URIs |

**Response `data`:**

```json
{
  "id": "uuid",
  "name": "pharmacy",
  "displayName": "Pharmacy App",
  "description": "Pharmacy management application",
  "clientId": "uuid-client-id",
  "clientSecret": "plain-text-secret-shown-once",
  "redirectUris": "[\"http://localhost:3000/callback\"]",
  "isActive": true,
  "createdAt": "2026-04-27T00:00:00.000Z",
  "updatedAt": "2026-04-27T00:00:00.000Z"
}
```

> The plain-text `clientSecret` is returned **only on creation**. It cannot be retrieved again.

**Error cases:**
- `400` — Application name already exists

---

#### 4. `PATCH /api/v1/applications/:id` — Update application

- **Auth:** JWT required
- **Permission:** `applications:write`

**Path Parameters:**

| Param | Type | Required | Validation |
|-------|------|----------|------------|
| `id` | `string (UUID)` | Yes | Must be valid UUID |

**Request Body:** (all fields optional)

```json
{
  "name": "pharmacy-v2",
  "displayName": "Pharmacy App V2",
  "description": "Updated description",
  "redirectUris": ["http://localhost:3000/callback", "http://prod.example.com/callback"]
}
```

**Response `data`:** Updated application object (no `clientSecret`).

---

#### 5. `PATCH /api/v1/applications/:id/status` — Activate/deactivate application

- **Auth:** JWT required
- **Permission:** `applications:write`

**Path Parameters:**

| Param | Type | Required | Validation |
|-------|------|----------|------------|
| `id` | `string (UUID)` | Yes | Must be valid UUID |

**Request Body:**

```json
{
  "isActive": false
}
```

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| `isActive` | `boolean` | **Yes** | `true` or `false` |

**Response `data`:** Updated application object.

---

#### 6. `POST /api/v1/applications/:id/regenerate-secret` — Regenerate client secret

- **Auth:** JWT required
- **Permission:** `applications:write`

**Path Parameters:**

| Param | Type | Required | Validation |
|-------|------|----------|------------|
| `id` | `string (UUID)` | Yes | Must be valid UUID |

**Request Body:** None.

**Response `data`:**

```json
{
  "clientSecret": "new-plain-text-secret-shown-once"
}
```

---

### Notifications API Contract (`/api/v1/notifications`)

---

#### 1. `GET /api/v1/notifications` — List notifications

- **Auth:** JWT required

**Request:** No body, no query params.

**Response `data`:**

```json
{
  "data": [],
  "message": "Notifications endpoint"
}
```

> Note: This endpoint is a placeholder. Full implementation TBD.

---

#### 2. `POST /api/v1/notifications/push` — Push real-time notification via WebSocket

- **Auth:** JWT required (user or service token)

**Request Body:**

```json
{
  "userId": "uuid-of-user",
  "organizationId": "uuid-of-org",
  "broadcast": false,
  "event": "order.created",
  "data": {
    "orderId": "123",
    "status": "confirmed",
    "total": 50000
  }
}
```

| Field | Type | Required | Validation | Description |
|-------|------|----------|------------|-------------|
| `userId` | `string` | No | — | Push to specific user (WebSocket room `user:{userId}`) |
| `organizationId` | `string` | No | — | Push to all users in org (WebSocket room `org:{orgId}`) |
| `broadcast` | `boolean` | No | — | Push to ALL connected clients |
| `event` | `string` | **Yes** | Non-empty | Socket.IO event name |
| `data` | `object` | **Yes** | Must be object | Arbitrary JSON payload |

> At least one of `userId`, `organizationId`, or `broadcast: true` must be provided.

**Response `data`:**

```json
{
  "target": "user",
  "userId": "uuid-of-user",
  "event": "order.created"
}
```

**Error cases:**
- `400` — Provide at least one target: userId, organizationId, or broadcast

---

#### 3. `PATCH /api/v1/notifications/:id/read` — Mark notification as read

- **Auth:** JWT required

**Path Parameters:**

| Param | Type | Required |
|-------|------|----------|
| `id` | `string` | Yes |

**Response `data`:**

```json
{
  "message": "Notification marked as read"
}
```

---

#### 4. `PATCH /api/v1/notifications/read-all` — Mark all notifications as read

- **Auth:** JWT required

**Request Body:** None.

**Response `data`:**

```json
{
  "message": "All notifications marked as read"
}
```

---

### Storage API Contract (`/api/v1/storage`)

---

#### 1. `POST /api/v1/storage/upload` — Upload file

- **Auth:** JWT required
- **Content-Type:** `multipart/form-data`
- **Max file size:** 10 MB

**Request Body (form-data):**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `file` | `binary` | **Yes** | File to upload |

**Response `data`:**

```json
{
  "key": "uuid-org/general/uuid-file.pdf",
  "size": 102400,
  "mimeType": "application/pdf"
}
```

> File is stored in MinIO at path `{organizationId}/general/{uuid}.{ext}`. The `organizationId` is extracted from the JWT.

---

#### 2. `GET /api/v1/storage/:key/presign` — Get presigned download URL

- **Auth:** JWT required

**Path Parameters:**

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `key` | `string` | Yes | File key from upload response |

**Response `data`:**

```json
"https://minio.example.com/main-core/uuid-org/general/uuid-file.pdf?X-Amz-..."
```

> Returns the presigned URL as a plain string. URL valid for 1 hour (3600 seconds).

---

#### 3. `DELETE /api/v1/storage/:key` — Delete file

- **Auth:** JWT required
- **Permission:** `storage:delete`

**Path Parameters:**

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `key` | `string` | Yes | File key to delete |

**Response `data`:**

```json
{
  "deleted": true
}
```

---

### Audit API Contract (`/api/v1/audit`)

> **Note:** Audit logging is currently **postponed**. The query endpoint works but no events are being recorded.

---

#### 1. `GET /api/v1/audit` — Query audit logs (paginated)

- **Auth:** JWT required
- **Permission:** `audit:read`

**Query Parameters:**

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `page` | `integer` | No | `1` | Page number |
| `limit` | `integer` | No | `20` | Items per page |
| `userId` | `string (UUID)` | No | — | Filter by user |
| `action` | `string` | No | — | Filter by action name |
| `organizationId` | `string (UUID)` | No | — | Filter by organization |
| `startDate` | `string (ISO 8601)` | No | — | From date |
| `endDate` | `string (ISO 8601)` | No | — | To date |

**Response `data`:**

```json
{
  "data": [
    {
      "id": "uuid",
      "userId": "uuid-user",
      "applicationId": null,
      "action": "user.created",
      "resource": "User",
      "ipAddress": "127.0.0.1",
      "userAgent": "Mozilla/5.0...",
      "metadata": {},
      "organizationId": "uuid-org",
      "createdAt": "2026-04-27T00:00:00.000Z"
    }
  ],
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 100,
    "totalPages": 5
  }
}
```

---

### Health API Contract (`/api/v1/health`)

---

#### 1. `GET /api/v1/health` — Health check

- **Auth:** Public

**Request:** No body, no query params.

**Response `data`:**

```json
{
  "status": "ok",
  "info": {
    "database": {
      "status": "up"
    },
    "minio": {
      "status": "up"
    }
  },
  "error": {},
  "details": {
    "database": {
      "status": "up"
    },
    "minio": {
      "status": "up"
    }
  }
}
```

> Uses `@nestjs/terminus` health check format. Checks PostgreSQL (via Prisma) and MinIO connectivity.
