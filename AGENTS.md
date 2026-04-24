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
- `npx prisma db seed` — run seed script (system roles, permissions)

Run a single test: `npx jest src/path/to/file.spec.ts`
Run a single e2e test: `npx jest --config ./test/jest-e2e.json test/app.e2e-spec.ts`

No typecheck script; use `npx tsc --noEmit`.

## Key facts

- NestJS v11, Express adapter, **modular monolith** (not microservices)
- TypeScript with `module: "nodenext"`, target `ES2023`, `noImplicitAny: false`, `strictNullChecks: true`
- ESLint uses `projectService: true` (type-aware linting) — typecheck errors can surface as lint errors
- ESLint rule overrides: `@typescript-eslint/no-explicit-any` is off, `no-floating-promises` and `no-unsafe-argument` are warn
- Prettier: single quotes, trailing commas (`.prettierrc`)
- All imports use `.js` extensions (required by `nodenext` module resolution)
- Jest v30 (both unit and e2e), ts-jest for transform
- In-process events via `@nestjs/event-emitter` (EventEmitter2) — no external message broker
- See `PLAN.md` for the full refactoring roadmap

## Project direction

This is `main-global-service` — the central identity & platform hub for all business apps (pharmacy, warehouse, market, transactions). It handles:

- **Authentication** — login, register, OAuth (Google), JWT, password management
- **User management** — profiles, CRUD, avatars
- **IAM** — fine-grained RBAC with roles, permissions, resource-level access per organization per application
- **Organizations** — multi-tenant boundaries, membership management
- **Applications** — register downstream business apps, OAuth2 client credentials
- **Notifications** — email (SMTP) + WebSocket push (Socket.IO)
- **Storage** — MinIO (S3-compatible) file/image management
- **Audit** — immutable event logging

Downstream services validate JWTs locally (ES256 public key) and optionally call this service's API for permission checks.

## Architecture (target)

```
src/
  main.ts                          # Bootstrap, global pipes/filters/interceptors, helmet, CORS, Swagger, Socket.IO
  app.module.ts                    # Root module, global guards (Throttler, JWT, Permissions)
  config/
    env.validation.ts              # class-validator startup validation
    logger.config.ts               # Winston config
  prisma/
    prisma.module.ts               # @Global() PrismaModule
    prisma.service.ts              # PrismaService (OnModuleInit/OnModuleDestroy)
  common/
    decorators/                    # @CurrentUser, @Public, @Roles, @Permissions
    filters/                       # AllExceptionsFilter
    guards/                        # JwtAuthGuard, RolesGuard, PermissionsGuard, ClientCredentialsGuard
    interceptors/                  # ResponseTransformInterceptor
    interfaces/                    # JwtPayload, AuthUser
    pipes/                         # ParseUUIDPipe
    utils/                         # duration parser, pagination helpers
  modules/
    auth/                          # Register, login, OAuth, JWT, refresh, passwords, client credentials, org switching
    users/                         # Profile CRUD, avatar upload
    organizations/                 # Multi-tenant org management, membership
    iam/                           # Roles, permissions, access control (sub-modules: roles, permissions, access)
    applications/                  # Downstream app registration, client credentials
    notifications/                 # Email + WebSocket (sub: email/, websocket/)
    storage/                       # MinIO upload/download, presigned URLs
    audit/                         # Immutable event log
    health/                        # DB + MinIO health checks
```

## Database schema (PostgreSQL via Prisma v6)

- **User** — id (UUID), email (unique), password, firstName?, lastName?, avatarUrl?, phone?, isActive, timestamps
- **Organization** — id (UUID), name, slug (unique), logoUrl?, isActive, timestamps
- **Application** — id (UUID), name (unique), displayName, clientId (unique), clientSecret (bcrypt-hashed), redirectUris?, isActive, timestamps
- **Role** — id (UUID), name, displayName, description?, isSystem, applicationId? (FK, null=global), timestamps
- **Permission** — id (UUID), name (unique), displayName, module, action, description?, applicationId? (FK, null=global), timestamps
- **RolePermission** — roleId (FK), permissionId (FK), unique on [roleId, permissionId]
- **UserRole** — userId (FK), roleId (FK), organizationId (FK), unique on [userId, roleId, organizationId]
- **PasswordReset** — id (UUID), userId (FK), token (unique, bcrypt-hashed), expiresAt, usedAt?, timestamps
- **AuditLog** — id (UUID), userId?, applicationId?, action, resource?, ipAddress?, userAgent?, metadata (Json), organizationId?, timestamps

No enums on User (roles via UserRole junction). Soft deletes via `isActive` on User and Organization.

## Routes

All routes under global prefix `/api/v1`. See `PLAN.md` for the complete route map.

## Request processing pipeline

1. Helmet (security headers)
2. CORS (explicit origins from env)
3. Winston logger (replaces NestJS default)
4. Global prefix `/api/v1`
5. Global `ValidationPipe` — whitelist, transform, enableImplicitConversion
6. Global guards: ThrottlerGuard (per-endpoint limits) → JwtAuthGuard (respects `@Public()`) → PermissionsGuard (checks `@Permissions()`)
7. `AllExceptionsFilter` — normalizes errors
8. `ResponseTransformInterceptor` — wraps success responses

## Authentication

- **Login**: Local strategy validates email/password, checks `isActive`, resolves roles for organization, issues JWT
- **Google OAuth**: passport-google-oauth20 — no hardcoded org, OAuth users prompted to join/create org
- **JWT**: passport-jwt verifies Bearer token using ES256 public key; `JwtStrategy.validate()` checks user exists and is active
- **RolesGuard**: reads roles from JWT payload (zero DB hits)
- **PermissionsGuard**: resolves roles → permissions via `AccessService` with in-memory cache (5 min TTL)
- **Client credentials**: OAuth2 flow for service-to-service auth — validates clientId + bcrypt-hashed clientSecret
- **Refresh**: rotation pattern — old refresh token invalidated, new pair issued, replay detection
- **Organization switching**: validates membership, issues new JWT with different org context
- **Token payload (user)**: `{ sub, email, type: "user", organizationId, roles: string[], iat, exp }` — signed with ES256 private key
- **Token payload (service)**: `{ sub: appName, type: "service", applicationId, permissions, iat, exp }` — signed with ES256 private key

## Environment variables

| Variable | Required | Default |
|----------|----------|---------|
| `DATABASE_URL` | Yes | — |
| `JWT_PRIVATE_KEY` | Yes | — | ES256 private key (PEM) for signing tokens |
| `JWT_PUBLIC_KEY` | Yes | — | ES256 public key (PEM) for verifying tokens |
| `JWT_ACCESS_EXPIRATION` | No | `900` (seconds) |
| `JWT_REFRESH_EXPIRATION` | No | `604800` (seconds) |
| `GOOGLE_CLIENT_ID` | No | — |
| `GOOGLE_CLIENT_SECRET` | No | — |
| `GOOGLE_CALLBACK_URL` | No | `http://localhost:3000/api/v1/auth/google/callback` |
| `SMTP_HOST` | No | `localhost` |
| `SMTP_PORT` | No | `587` |
| `SMTP_USER` | No | `''` |
| `SMTP_PASS` | No | `''` |
| `SMTP_FROM` | No | `noreply@example.com` |
| `FRONTEND_URL` | No | `http://localhost:5173` |
| `MINIO_ENDPOINT` | No | `localhost` |
| `MINIO_PORT` | No | `9000` |
| `MINIO_ACCESS_KEY` | No | `minioadmin` |
| `MINIO_SECRET_KEY` | No | `minioadmin` |
| `MINIO_BUCKET` | No | `main-global` |
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
