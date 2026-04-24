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
      websocket/                   # Socket.IO gateway (/ws), user/org rooms
    storage/                       # MinIO upload/download, presigned URLs
    audit/                         # Query audit logs with filters (POSTPONED — emissions disabled)
    health/                        # DB + MinIO health checks via @nestjs/terminus
```

## Database schema (PostgreSQL via Prisma v6)

- **User** — id (UUID), email (unique), password, firstName?, lastName?, avatarUrl?, phone?, isActive, timestamps
- **Organization** — id (UUID), name, slug (unique), logoUrl?, isActive, timestamps
- **Application** — id (UUID), name (unique), displayName, description?, clientId (unique), clientSecret (bcrypt-hashed), redirectUris?, isActive, timestamps
- **Role** — id (UUID), name, displayName, description?, isSystem, applicationId? (FK, null=global), timestamps
- **Permission** — id (UUID), name (unique), displayName, module, action, description?, applicationId? (FK, null=global), createdAt
- **RolePermission** — id (UUID), roleId (FK), permissionId (FK), unique on [roleId, permissionId]
- **UserRole** — id (UUID), userId (FK), roleId (FK), organizationId (FK), unique on [userId, roleId, organizationId]
- **RefreshToken** — id (UUID), userId (FK), token (unique), expiresAt, isUsed, createdAt
- **PasswordReset** — id (UUID), userId (FK), token (unique, bcrypt-hashed), expiresAt, usedAt?, createdAt
- **AuditLog** — id (UUID), userId?, applicationId?, action, resource?, ipAddress?, userAgent?, metadata (Json), organizationId?, createdAt

No enums on User (roles via UserRole junction). Soft deletes via `isActive` on User and Organization.

## Route Map

All routes under global prefix `/api/v1`.

### Auth (`/api/v1/auth`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/register` | Public | Register — auto-creates org, assigns org_admin role |
| POST | `/login` | Public + LocalAuthGuard | Login, returns accessToken + refreshToken |
| GET | `/google` | Public + GoogleAuthGuard | Google OAuth redirect |
| GET | `/google/callback` | Public + GoogleAuthGuard | Google OAuth callback |
| GET | `/verify-token` | JWT | Validates token, returns user |
| POST | `/refresh-token` | Public | Refresh token (rotation: old token invalidated) |
| POST | `/set-password` | JWT | Set password for OAuth users |
| POST | `/change-password` | JWT | Change password (requires current password) |
| POST | `/forgot-password` | Public | Send reset email |
| POST | `/reset-password` | Public | Reset password via token |
| POST | `/token` | Public | OAuth2 client credentials grant |
| POST | `/switch-organization` | JWT | Switch org context, get new JWT |
| POST | `/logout` | JWT | Invalidate refresh token |

### Users (`/api/v1/users`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/me` | JWT | Current user profile + roles + org memberships |
| PATCH | `/me` | JWT | Update own profile |
| GET | `/` | `users:read` | List users (paginated, org-scoped) |
| GET | `/:id` | `users:read` | Get user by ID |
| POST | `/` | `users:write` | Create user |
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
| GET | `/check` | JWT | Check permission (`?permission=...&organizationId=...`) |
| GET | `/my-permissions` | JWT | All permissions for current user in current org |
| GET | `/my-organizations` | JWT | Organizations the current user belongs to |

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

- **Login**: Local strategy validates email/password, checks `isActive`, resolves roles for organization, issues JWT
- **Account lockout**: 5 consecutive failed logins → 15-minute lock on same email
- **Google OAuth**: passport-google-oauth20 — no hardcoded org, OAuth users prompted to join/create org. Falls back gracefully when `GOOGLE_CLIENT_ID` is not set.
- **JWT**: passport-jwt verifies Bearer token using ES256 public key; `JwtStrategy.validate()` checks user exists and is active
- **RolesGuard**: reads roles from JWT payload (zero DB hits)
- **PermissionsGuard**: resolves roles → permissions via `AccessService` with in-memory cache (5 min TTL)
- **Client credentials**: OAuth2 flow for service-to-service auth — validates clientId + bcrypt-hashed clientSecret
- **Refresh**: rotation pattern — old refresh token invalidated, new pair issued, replay detection (revokes all sessions on reuse)
- **Organization switching**: validates membership, issues new JWT with different org context
- **Token payload (user)**: `{ sub, email, type: "user", organizationId, roles: string[], iat, exp }` — signed with ES256 private key
- **Token payload (service)**: `{ sub: appName, type: "service", applicationId, permissions, iat, exp }` — signed with ES256 private key
- **Token signing**: ES256 asymmetric (ECDSA P-256). Private key signs, public key verifies. PEM keys stored as single-line `\n`-escaped strings in env vars.

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
