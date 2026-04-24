# Main Core Service

Central identity & platform hub for all business apps (pharmacy, warehouse, market, transactions). Built as a NestJS modular monolith with PostgreSQL, MinIO, and Socket.IO.

## Quick Start

```bash
# Install dependencies
npm install

# Generate ES256 key pair (first time only)
openssl ecparam -name prime256v1 -genkey -noout -out ec-private.pem
openssl ec -in ec-private.pem -pubout -out ec-public.pem

# Copy and configure environment
cp .env.example .env
# Edit .env — paste the PEM keys as single-line strings with \n escapes

# Setup database
npx prisma migrate dev
npx prisma db seed

# Start dev server
npm run start:dev
```

Server runs on `http://localhost:3000` by default.

- **Swagger UI**: http://localhost:3000/docs
- **Health check**: http://localhost:3000/api/v1/health

## Seeded Admin

After running `npx prisma db seed`:

- **Email**: `superadmin@maincore.dev`
- **Password**: `SuperAdmin123!`
- **Role**: `system_admin` (all permissions)

## Modules

| Module | Prefix | Description |
|--------|--------|-------------|
| Auth | `/api/v1/auth` | Register, login, Google OAuth, JWT, refresh rotation, password management, client credentials, org switching |
| Users | `/api/v1/users` | Profile CRUD, admin user management, avatars |
| Organizations | `/api/v1/organizations` | Multi-tenant org management, member roles |
| IAM — Roles | `/api/v1/roles` | Role CRUD, assign permissions to roles |
| IAM — Permissions | `/api/v1/permissions` | Permission CRUD |
| IAM — Access | `/api/v1/iam` | Permission checks, my-permissions, my-organizations |
| Applications | `/api/v1/applications` | Register downstream apps, OAuth2 client credentials |
| Notifications | `/api/v1/notifications` | Email (SMTP) + WebSocket push (Socket.IO on `/ws`) |
| Storage | `/api/v1/storage` | MinIO file upload/download, presigned URLs |
| Audit | `/api/v1/audit` | Query audit logs (postponed — see below) |
| Health | `/api/v1/health` | DB + MinIO health checks |

## Authentication

### User JWT (login/register)

```
Authorization: Bearer <token>
```

Token payload:
```json
{
  "sub": "user-uuid",
  "email": "user@example.com",
  "type": "user",
  "organizationId": "org-uuid",
  "roles": ["org_admin"],
  "iat": 1234567890,
  "exp": 1234567890
}
```

Signed with **ES256** (asymmetric). This service signs with a private key. Downstream services verify with the public key (`JWT_PUBLIC_KEY` env var) — no shared secrets.

### Service JWT (client credentials)

```bash
POST /api/v1/auth/token
{
  "grantType": "client_credentials",
  "clientId": "<from app registration>",
  "clientSecret": "<shown once at creation>"
}
```

### Refresh Token Rotation

- Each refresh generates a new token pair, old token is invalidated
- Token reuse detection: if a used refresh token is presented again, all sessions for that user are terminated

### Account Lockout

- 5 consecutive failed login attempts → 15-minute lockout
- Counter resets on successful login

## Authorization

Guards are applied globally in order:

```
ThrottlerGuard → JwtAuthGuard → RolesGuard → PermissionsGuard
```

- `@Public()` — skip JWT/auth checks
- `@Roles('admin')` — require role (reads from JWT, zero DB hits)
- `@Permissions('users:write')` — require permission (resolves via cached AccessService, 5-min TTL)

## Environment Variables

| Variable | Required | Default |
|----------|----------|---------|
| `DATABASE_URL` | Yes | — |
| `JWT_PRIVATE_KEY` | Yes | — |
| `JWT_PUBLIC_KEY` | Yes | — |
| `JWT_ACCESS_EXPIRATION` | No | `900` (15 min) |
| `JWT_REFRESH_EXPIRATION` | No | `604800` (7 days) |
| `GOOGLE_CLIENT_ID` | No | — |
| `GOOGLE_CLIENT_SECRET` | No | — |
| `GOOGLE_CALLBACK_URL` | No | `http://localhost:3000/api/v1/auth/google/callback` |
| `SMTP_HOST` | No | `localhost` |
| `SMTP_PORT` | No | `587` |
| `SMTP_USER` | No | `''` |
| `SMTP_PASS` | No | `''` |
| `SMTP_FROM` | No | `noreply@example.com` |
| `FRONTEND_URL` | No | `http://localhost:5173` |
| `CORS_ORIGINS` | No | `http://localhost:5173` |
| `MINIO_ENDPOINT` | No | `localhost` |
| `MINIO_PORT` | No | `9000` |
| `MINIO_ACCESS_KEY` | No | `minioadmin` |
| `MINIO_SECRET_KEY` | No | `minioadmin` |
| `MINIO_BUCKET` | No | `main-core` |
| `MINIO_USE_SSL` | No | `false` |

PEM keys must be set as single-line strings with `\n` escape characters:
```
JWT_PRIVATE_KEY="-----BEGIN EC PRIVATE KEY-----\nMHcCAQEE...base64...\n-----END EC PRIVATE KEY-----"
```

## Docker

```bash
# Build and run with MinIO
docker compose up -d

# Run migrations inside container
docker compose exec app npx prisma migrate deploy
docker compose exec app npx prisma db seed
```

MinIO console available at `http://localhost:9001`.

## Scripts

```bash
npm run build          # Compile to dist/
npm run start:dev      # Dev server with watch
npm run lint           # ESLint with auto-fix
npm run format         # Prettier
npm run test           # Unit tests
npm run test:e2e       # E2E tests
npm run test:cov       # Coverage report
npx tsc --noEmit       # Type check
npx prisma migrate dev # Create migration
npx prisma db seed     # Seed roles & permissions
```

## Postponed Features

### Audit Logging

The audit module is fully built but **disabled** to save database storage. All `audit.log` event emissions are commented out with:

```typescript
// TODO: audit.log - postponed (see AGENTS.md)
```

To re-enable: uncomment all `TODO: audit.log` lines, re-add `EventEmitter2` injection where removed, and consider using a `@Auditable()` decorator pattern for cleaner implementation.

### Shared Auth Library

`@main-core/auth-client` npm package for downstream services — guards, types, and API client. To be built when there are downstream services to integrate.

## License

UNLICENSED — Private project.
