# Frontend API Integration Guide

Base URL: `http://localhost:3000/api/v1`

---

## Response Format

All responses use a consistent envelope.

### Success

```json
{
  "statusCode": 200,
  "message": "Success",
  "data": { ... },
  "timestamp": "2026-04-24T12:00:00.000Z",
  "path": "/api/v1/auth/login"
}
```

### Error

```json
{
  "statusCode": 401,
  "message": "Unauthorized",
  "error": "Unauthorized",
  "timestamp": "2026-04-24T12:00:00.000Z",
  "path": "/api/v1/auth/login"
}
```

### Validation Error (400)

```json
{
  "statusCode": 400,
  "message": "Validation error",
  "errors": [
    "email must be an email",
    "password must not be empty"
  ],
  "timestamp": "2026-04-24T12:00:00.000Z",
  "path": "/api/v1/auth/register"
}
```

### Paginated List

All paginated endpoints return data wrapped in pagination metadata. Access items at `response.data.data[]` and pagination info at `response.data.meta`.

```json
{
  "statusCode": 200,
  "message": "Success",
  "data": {
    "data": [ ... ],
    "meta": {
      "page": 1,
      "limit": 20,
      "total": 100,
      "totalPages": 5
    }
  },
  "timestamp": "...",
  "path": "/api/v1/users"
}
```

---

## Authentication

All protected endpoints require a Bearer token in the `Authorization` header:

```
Authorization: Bearer <accessToken>
```

### Token Lifecycle

| Token | Lifetime | Purpose |
|-------|----------|---------|
| Access Token | 15 min (`JWT_ACCESS_EXPIRATION`, default 900s) | Authenticate API requests |
| Refresh Token | 7 days (`JWT_REFRESH_EXPIRATION`, default 604800s) | Get a new access token pair |

### JWT Payload (decoded access token — user)

```json
{
  "sub": "user-uuid",
  "email": "john@example.com",
  "type": "user",
  "organizationId": "org-uuid",
  "applicationId": "app-uuid-or-null",
  "roles": ["org_admin"],
  "permissions": ["users:read", "users:write", "roles:read"],
  "iat": 1713945600,
  "exp": 1713946500
}
```

### JWT Payload (decoded access token — service)

```json
{
  "sub": "pharmacy-app",
  "type": "service",
  "applicationId": "app-uuid",
  "permissions": ["inventory:read", "inventory:write"],
  "iat": 1713945600,
  "exp": 1713946500
}
```

### Permission System

The JWT contains a `permissions` array (e.g. `["users:read", "users:write"]`). The `PermissionsGuard` checks this array directly — **zero DB hits for permission checks**. Endpoints annotated with `@Permissions('users:read')` require that exact permission string in the token.

The `permissions` in the JWT are resolved at login time via `resolveUserClaims()`, which:
1. Finds all `UserRole` records for the user in the current `organizationId`
2. Filters roles by `applicationId` (global roles with `applicationId: null` are always included; app-scoped roles only appear when the session's `applicationId` matches)
3. Collects all permissions from those roles

---

## Auth Endpoints

### Register

```
POST /api/v1/auth/register
```

**Rate limit:** 3 requests / 60 seconds

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
| `email` | string | **Yes** | Valid email, unique | |
| `password` | string | **Yes** | Min 8 chars, must contain uppercase, lowercase, and number | |
| `firstName` | string | No | | |
| `lastName` | string | No | | |
| `applicationId` | string (UUID) | No | Valid UUID, active application | Scopes the auto-created org to this app |

**Response `data`:**

```json
{
  "accessToken": "eyJhbGci...",
  "refreshToken": "a1b2c3d4...",
  "user": {
    "id": "uuid",
    "email": "john@example.com",
    "firstName": "John",
    "lastName": "Doe",
    "avatarUrl": null,
    "phone": null,
    "isActive": true,
    "createdAt": "...",
    "updatedAt": "..."
  },
  "organization": {
    "id": "uuid",
    "name": "Organization of John",
    "slug": "org-a1b2c3d4",
    "logoUrl": null,
    "applicationId": null,
    "isActive": true,
    "createdAt": "...",
    "updatedAt": "..."
  }
}
```

**Business logic:**
- Auto-creates an org named `"Organization of {firstName or email}"` with slug `"org-{random8}"`
- Org is scoped to `applicationId` if provided (null = global)
- Assigns the `org_admin` system role (global, `applicationId: null`) to the user in that org
- Emits `user.registered` event (sends welcome email + WebSocket notification)
- Returns tokens, user, and org

**Error cases:**
- `400` — Email already in use
- `400` — Invalid or inactive application

---

### Login

```
POST /api/v1/auth/login
```

**Rate limit:** 5 requests / 60 seconds  
**Account lockout:** 5 consecutive failed attempts → 15-minute lock on same email

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
| `email` | string | **Yes** | Valid email | |
| `password` | string | **Yes** | Non-empty | |
| `applicationId` | string (UUID) | No | Valid UUID | Scope session to app; resolves user's first org in that app |

**Response `data`:**

```json
{
  "accessToken": "eyJhbGci...",
  "refreshToken": "a1b2c3d4..."
}
```

**Business logic:**
- If `applicationId` is provided: finds the user's first `UserRole` where the org belongs to that app, scopes the JWT to that org+app
- If no `applicationId`: uses user's first org
- Stores refresh token with `organizationId` + `applicationId` to maintain session context across refreshes
- Failed password check increments lockout counter; 5th failure sets 15-min lock

**Error cases:**
- `401` — Invalid credentials or account locked
- `400` — No organization in the specified application

---

### Google OAuth Flow

```
1. Frontend redirects user to: GET /api/v1/auth/google
2. User authenticates with Google
3. Google redirects back to: GET /api/v1/auth/google/callback
4. Server redirects to: {FRONTEND_URL}/auth/google/callback?accessToken=...&refreshToken=...
5. Frontend extracts tokens from URL query params
```

> Only works when `GOOGLE_CLIENT_ID` env is set. Google users must already have an account (no auto-registration).

---

### Verify Token

```
GET /api/v1/auth/verify-token
Authorization: Bearer <accessToken>
```

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
    "iat": 1713945600,
    "exp": 1713946500
  }
}
```

> Returns the decoded JWT payload directly. No DB hit.

---

### Refresh Token

```
POST /api/v1/auth/refresh-token
```

**Request Body:**

```json
{
  "refreshToken": "a1b2c3d4..."
}
```

**Response `data`:**

```json
{
  "accessToken": "eyJhbGci...",
  "refreshToken": "new-refresh-token..."
}
```

**Business logic:**
- Rotation pattern: old refresh token marked `isUsed: true`, new pair issued
- **Replay detection**: if an already-used token is presented, ALL refresh tokens for that user are deleted (terminates all sessions)
- Refresh tokens store `organizationId` + `applicationId` — context is preserved across refreshes
- Validates user still exists and is active
- Re-resolves roles/permissions from DB (reflects any role changes since last login)

**Error cases:**
- `401` — Invalid, expired, or reused refresh token

---

### Set Password (for OAuth users who have no password)

```
POST /api/v1/auth/set-password
Authorization: Bearer <accessToken>
```

**Request Body:**

```json
{
  "newPassword": "Str0ng!Pass1"
}
```

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| `newPassword` | string | **Yes** | Min 8 chars, uppercase + lowercase + number |

**Response `data`:**

```json
{
  "message": "Password set successfully"
}
```

**Error cases:**
- `400` — Password already set. Use change password instead.

---

### Change Password

```
POST /api/v1/auth/change-password
Authorization: Bearer <accessToken>
```

**Request Body:**

```json
{
  "currentPassword": "currentPassword123",
  "newPassword": "Str0ng!Pass1"
}
```

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| `currentPassword` | string | **Yes** | Non-empty |
| `newPassword` | string | **Yes** | Min 8 chars, uppercase + lowercase + number |

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

### Forgot Password

```
POST /api/v1/auth/forgot-password
```

**Rate limit:** 3 requests / 60 seconds

**Request Body:**

```json
{
  "email": "john@example.com"
}
```

**Response `data`:**

```json
{
  "message": "If the email exists, a reset link will be sent"
}
```

**Business logic:**
- Always returns the same message (prevents email enumeration)
- If email exists: generates a UUID reset token, hashes it with bcrypt, stores in `PasswordReset` table (expires in 1 hour)
- Emits `user.forgot_password` event which sends an email with link: `{FRONTEND_URL}/reset-password?token={token}&email={email}`

---

### Reset Password

```
POST /api/v1/auth/reset-password
```

**Request Body:**

```json
{
  "token": "reset-token-from-email",
  "email": "john@example.com",
  "newPassword": "NewStr0ng!Pass1"
}
```

| Field | Type | Required | Validation | Description |
|-------|------|----------|------------|-------------|
| `token` | string | **Yes** | Non-empty | Reset token from email |
| `newPassword` | string | **Yes** | Min 8 chars, uppercase + lowercase + number | |
| `email` | string | No | Valid email | Helps locate the user account |

**Response `data`:**

```json
{
  "message": "Password reset successfully"
}
```

**Business logic:**
- Looks up user by email (if provided), then checks the 10 most recent unused, unexpired `PasswordReset` records
- Compares token with bcrypt hash to find the match
- Updates password, marks token as used
- **Invalidates ALL refresh tokens** for the user (force re-login on all devices)

**Error cases:**
- `401` — Invalid or expired reset token

---

### Client Credentials (OAuth2 — for service-to-service)

```
POST /api/v1/auth/token
```

**Request Body:**

```json
{
  "grantType": "client_credentials",
  "clientId": "uuid-client-id",
  "clientSecret": "plain-text-secret"
}
```

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| `grantType` | string | No | Usually `client_credentials` |
| `clientId` | string | **Yes** | Non-empty |
| `clientSecret` | string | **Yes** | Non-empty |

**Response `data`:**

```json
{
  "accessToken": "eyJhbGci...",
  "tokenType": "Bearer",
  "expiresIn": 900
}
```

> Service token payload: `{ sub: appName, type: "service", applicationId, permissions, iat, exp }`. Permissions are all permissions belonging to that application.

**Error cases:**
- `401` — Invalid client credentials

---

### Switch Organization

```
POST /api/v1/auth/switch-organization
Authorization: Bearer <accessToken>
```

**Request Body:**

```json
{
  "organizationId": "target-org-uuid"
}
```

**Response `data`:**

```json
{
  "accessToken": "eyJhbGci...",
  "refreshToken": "new-refresh-token..."
}
```

**Business logic:**
- Validates user is a member of the target org
- Derives `applicationId` from the target org
- Re-resolves roles/permissions for the new org+app context
- Issues new access + refresh tokens

**Error cases:**
- `400` — Not a member of this organization
- `400` — Organization not found

---

### Logout

```
POST /api/v1/auth/logout
Authorization: Bearer <accessToken>
```

**Request Body (optional):**

```json
{
  "refreshToken": "a1b2c3d4..."
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `refreshToken` | string | No | If provided, invalidates only this session. If omitted, invalidates ALL refresh tokens. |

**Response `data`:**

```json
{
  "message": "Logged out successfully"
}
```

---

## User Endpoints

### Get Current User Profile

```
GET /api/v1/users/me
Authorization: Bearer <accessToken>
```

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
  "createdAt": "...",
  "updatedAt": "...",
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
        "displayName": "Organization Admin",
        "description": "...",
        "isSystem": true,
        "applicationId": null,
        "createdAt": "...",
        "updatedAt": "..."
      }
    }
  ]
}
```

> Returns user with all organization memberships and roles. No permission required (any authenticated user).

---

### Update Own Profile

```
PATCH /api/v1/users/me
Authorization: Bearer <accessToken>
```

**Request Body:** (all optional)

```json
{
  "firstName": "Jane",
  "lastName": "Smith",
  "phone": "+1234567890"
}
```

| Field | Type | Required |
|-------|------|----------|
| `firstName` | string | No |
| `lastName` | string | No |
| `phone` | string | No |

> Cannot update email, password, isActive, or avatarUrl via this endpoint.

**Response `data`:** Updated user object (without password, without organizations).

---

### List Users (admin, paginated)

```
GET /api/v1/users?page=1&limit=20&organizationId=uuid&applicationId=uuid&search=john
Authorization: Bearer <accessToken>
```

**Permission:** `users:read`

**Query Parameters:**

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `page` | integer | No | `1` | Page number (min 1) |
| `limit` | integer | No | `20` | Items per page (min 1) |
| `organizationId` | string (UUID) | No | | Filter by organization |
| `applicationId` | string (UUID) | No | | Filter by application (ignored if `organizationId` is also provided) |
| `search` | string | No | | Search by firstName, lastName, or email (case-insensitive, partial match) |

**Business logic:**
- Non-system_admin users can only see users in their own organization (`organizationId` forced to their JWT org)
- System admins can filter by any org or application
- Results ordered by `createdAt` desc

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
      "createdAt": "...",
      "updatedAt": "..."
    }
  ],
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 45,
    "totalPages": 3
  }
}
```

---

### Get User by ID (admin)

```
GET /api/v1/users/:id
Authorization: Bearer <accessToken>
```

**Permission:** `users:read`  
**Path params:** `:id` must be valid UUID

**Business logic:**
- Non-system_admin users can only view users within their own org (returns `403` otherwise)
- System admins can view any user
- Returns user with organization memberships and roles

**Response `data`:** Same shape as `GET /users/me` (user object with `organizations` array).

---

### Create User (admin)

```
POST /api/v1/users
Authorization: Bearer <accessToken>
```

**Permission:** `users:write`

**Request Body:**

```json
{
  "email": "john@example.com",
  "password": "Str0ng!Pass1",
  "firstName": "John",
  "lastName": "Doe",
  "phone": "+1234567890",
  "organizationId": "uuid-org"
}
```

| Field | Type | Required | Validation | Description |
|-------|------|----------|------------|-------------|
| `email` | string | **Yes** | Valid email, unique | |
| `password` | string | **Yes** | Min 8 chars, uppercase + lowercase + number | |
| `firstName` | string | No | | |
| `lastName` | string | No | | |
| `phone` | string | No | | |
| `organizationId` | string (UUID) | No | Valid UUID | Defaults to admin's current org from JWT |

**Business logic:**
- Non-system_admin can only create users in their own organization
- Finds the **lowest-permission role** (role with fewest permissions) for the org's `applicationId` (including global roles) and auto-assigns it
- If no roles exist, user is created without any role assignment
- Password is hashed with bcrypt

**Response `data`:** Created user object (without password).

**Error cases:**
- `400` — Email already in use
- `400` — Organization not found (if provided and invalid)
- `403` — Cannot create users in another organization

---

### Update User (admin)

```
PATCH /api/v1/users/:id
Authorization: Bearer <accessToken>
```

**Permission:** `users:write`  
**Path params:** `:id` must be valid UUID

**Request Body:** (all optional — partial of `CreateUserDto` minus `password` and `organizationId`)

```json
{
  "email": "newemail@example.com",
  "firstName": "Jane",
  "lastName": "Smith",
  "phone": "+1987654321"
}
```

**Business logic:**
- Non-system_admin can only update users in their own org
- Cannot modify system administrators (unless you are system_admin)
- `password` is NOT updatable via this endpoint

**Response `data`:** Updated user object (without password).

---

### Update User Status (activate/deactivate)

```
PATCH /api/v1/users/:id/status
Authorization: Bearer <accessToken>
```

**Permission:** `users:write`  
**Path params:** `:id` must be valid UUID

**Request Body:**

```json
{
  "isActive": false
}
```

**Business logic:**
- Cannot change your own status
- Non-system_admin can only affect users in their own org
- Cannot modify system administrators (unless you are system_admin)

**Response `data`:**

```json
{
  "id": "uuid",
  "email": "john@example.com",
  "isActive": false
}
```

---

### Delete User (soft delete)

```
DELETE /api/v1/users/:id
Authorization: Bearer <accessToken>
```

**Permission:** `users:delete`  
**Path params:** `:id` must be valid UUID

**Business logic:**
- Cannot delete your own account
- Non-system_admin can only delete users in their own org
- Cannot delete system administrators (unless you are system_admin)
- **Soft delete**: sets `isActive: false` (does not remove from DB)

**Response `data`:** Updated user object with `isActive: false`.

---

## Organization Endpoints

### List Organizations (paginated, public)

```
GET /api/v1/organizations?page=1&limit=20&applicationId=uuid
```

> **Public** — no auth required.

**Query Parameters:**

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `page` | integer | No | `1` | |
| `limit` | integer | No | `20` | |
| `applicationId` | string (UUID) | No | | Filter by application |

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
      "createdAt": "...",
      "updatedAt": "..."
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

### Get Organization by ID (public)

```
GET /api/v1/organizations/:id
```

> **Public** — no auth required.

**Response `data`:** Single organization object.

---

### Get Organization by Slug (public)

```
GET /api/v1/organizations/slug/:slug?applicationId=uuid
```

> **Public** — no auth required.

**Query Parameters:**

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `applicationId` | string (UUID) | No | Disambiguate when same slug exists across apps |

**Business logic:** Looks up org where `slug` matches AND `applicationId` matches (or `null` if no `applicationId` provided).

**Response `data`:** Single organization object.

---

### Create Organization

```
POST /api/v1/organizations
Authorization: Bearer <accessToken>
```

**Permission:** `organizations:write`

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
| `name` | string | **Yes** | Non-empty | |
| `slug` | string | **Yes** | Non-empty | Unique per application |
| `applicationId` | string (UUID) | No | Valid UUID, active app | `null` = global org |

**Error cases:**
- `400` — Invalid or inactive application

**Response `data`:** Created organization object.

---

### Update Organization

```
PATCH /api/v1/organizations/:id
Authorization: Bearer <accessToken>
```

**Permission:** `organizations:write`  
**Path params:** `:id` must be valid UUID

**Request Body:** (all optional)

```json
{
  "name": "New Name",
  "slug": "new-slug",
  "applicationId": "uuid-app"
}
```

**Response `data`:** Updated organization object.

---

### Update Organization Status (activate/deactivate)

```
PATCH /api/v1/organizations/:id/status
Authorization: Bearer <accessToken>
```

**Permission:** `organizations:write`

**Request Body:**

```json
{
  "isActive": false
}
```

**Response `data`:** Updated organization object.

---

### List Organization Members

```
GET /api/v1/organizations/:id/members
Authorization: Bearer <accessToken>
```

**Permission:** `organizations:read`  
**Path params:** `:id` must be valid UUID

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
      "lastName": "Doe",
      "avatarUrl": null
    },
    "role": {
      "id": "uuid-role",
      "name": "org_admin",
      "displayName": "Organization Admin",
      "description": "...",
      "isSystem": true,
      "applicationId": null,
      "createdAt": "...",
      "updatedAt": "..."
    }
  }
]
```

---

### Add Member to Organization

```
POST /api/v1/organizations/:id/members
Authorization: Bearer <accessToken>
```

**Permission:** `organizations:write`  
**Path params:** `:id` must be valid UUID

**Request Body:**

```json
{
  "userId": "uuid-of-user",
  "roleId": "uuid-of-role"
}
```

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| `userId` | string (UUID) | **Yes** | Valid UUID |
| `roleId` | string (UUID) | **Yes** | Valid UUID |

**Business logic:**
- **Role-app consistency check**: When the org is app-scoped (`applicationId` not null), the assigned role must be either global (`applicationId: null`) or belong to the same app. Returns `400` if mismatch.

**Response `data`:** Created UserRole object.

**Error cases:**
- `400` — Role does not belong to the same application as this organization

---

### Update Member Role

```
PATCH /api/v1/organizations/:id/members/:userId
Authorization: Bearer <accessToken>
```

**Permission:** `organizations:write`  
**Path params:** Both must be valid UUID

**Request Body:**

```json
{
  "roleId": "uuid-of-new-role"
}
```

**Response `data`:** Updated UserRole object.

---

### Remove Member from Organization

```
DELETE /api/v1/organizations/:id/members/:userId
Authorization: Bearer <accessToken>
```

**Permission:** `organizations:write`  
**Path params:** Both must be valid UUID

**Response `data`:** Deleted UserRole object.

---

## IAM — Roles Endpoints

### List Roles

```
GET /api/v1/roles?applicationId=uuid
Authorization: Bearer <accessToken>
```

**Permission:** `roles:read`

**Query Parameters:**

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `applicationId` | string (UUID) | No | Filter by application |

**Response `data`:** Array of role objects (includes `rolePermissions` with nested `permission` objects). Ordered by `createdAt` desc.

---

### Get Role with Permissions

```
GET /api/v1/roles/:id
Authorization: Bearer <accessToken>
```

**Permission:** `roles:read`  
**Path params:** `:id` must be valid UUID

**Response `data`:**

```json
{
  "id": "uuid",
  "name": "org_admin",
  "displayName": "Organization Admin",
  "description": "...",
  "isSystem": true,
  "applicationId": null,
  "createdAt": "...",
  "updatedAt": "...",
  "permissions": [
    {
      "id": "uuid",
      "name": "users:read",
      "displayName": "Read Users",
      "module": "users",
      "action": "read",
      "description": null,
      "applicationId": null,
      "createdAt": "..."
    }
  ]
}
```

---

### Create Role

```
POST /api/v1/roles
Authorization: Bearer <accessToken>
```

**Permission:** `roles:write`

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
| `name` | string | **Yes** | Non-empty, unique per application scope | |
| `displayName` | string | **Yes** | Non-empty | |
| `description` | string | No | | |
| `applicationId` | string (UUID) | No | Valid UUID | `null` = global role |

> `isSystem` is always `false` for user-created roles.

**Error cases:**
- `400` — Role name already exists in this scope

---

### Update Role

```
PATCH /api/v1/roles/:id
Authorization: Bearer <accessToken>
```

**Permission:** `roles:write`

**Request Body:** (all optional)

```json
{
  "name": "senior-pharmacist",
  "displayName": "Senior Pharmacist",
  "description": "...",
  "applicationId": "uuid-app"
}
```

**Response `data`:** Updated role object.

---

### Delete Role

```
DELETE /api/v1/roles/:id
Authorization: Bearer <accessToken>
```

**Permission:** `roles:delete`

**Error cases:**
- `400` — Cannot delete system roles (`isSystem: true`)

**Response `data`:** Deleted role object.

---

### Assign Permissions to Role

```
POST /api/v1/roles/:id/permissions
Authorization: Bearer <accessToken>
```

**Permission:** `roles:write`

**Request Body:**

```json
{
  "permissionIds": ["uuid-1", "uuid-2"]
}
```

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| `permissionIds` | string[] | **Yes** | Array of valid UUIDs |

> Uses upsert — already-assigned permissions are skipped without error.

**Response `data`:** Role with updated permissions list (same shape as GET `/:id`).

---

### Remove Permission from Role

```
DELETE /api/v1/roles/:id/permissions/:permissionId
Authorization: Bearer <accessToken>
```

**Permission:** `roles:write`

**Response `data`:** Role with updated permissions list (same shape as GET `/:id`).

---

## IAM — Permissions Endpoints

### List Permissions

```
GET /api/v1/permissions?applicationId=uuid&module=users
Authorization: Bearer <accessToken>
```

**Permission:** `permissions:read`

**Query Parameters:**

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `applicationId` | string (UUID) | No | Filter by application |
| `module` | string | No | Filter by module name |

**Response `data`:** Array of permission objects. Ordered by `module` asc, `action` asc.

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
    "createdAt": "..."
  }
]
```

---

### Get Permission

```
GET /api/v1/permissions/:id
Authorization: Bearer <accessToken>
```

**Permission:** `permissions:read`

**Response `data`:** Single permission object.

---

### Create Permission

```
POST /api/v1/permissions
Authorization: Bearer <accessToken>
```

**Permission:** `permissions:write`

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
| `name` | string | **Yes** | Non-empty, unique | Format: `module:action` |
| `displayName` | string | **Yes** | Non-empty | |
| `module` | string | **Yes** | Non-empty | |
| `action` | string | **Yes** | Non-empty | |
| `description` | string | No | | |
| `applicationId` | string (UUID) | No | Valid UUID | `null` = global |

**Error cases:**
- `400` — Permission name already exists

---

### Delete Permission

```
DELETE /api/v1/permissions/:id
Authorization: Bearer <accessToken>
```

**Permission:** `permissions:delete`

**Response `data`:** Deleted permission object.

---

## IAM — Access Endpoints

### Check Permission

```
GET /api/v1/iam/check?permission=users:write&organizationId=org-uuid&applicationId=app-uuid
Authorization: Bearer <accessToken>
```

**Query Parameters:**

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `permission` | string | **Yes** | Permission name to check |
| `organizationId` | string (UUID) | No | Defaults to JWT's `organizationId` |
| `applicationId` | string (UUID) | No | Defaults to JWT's `applicationId` |

**Response `data`:**

```json
{
  "permission": "users:read",
  "authorized": true
}
```

> Uses AccessService with 5-minute in-memory cache. Cache key: `{userId}:{orgId}:{appId or 'global'}:{sorted roles}`.

---

### Get My Permissions

```
GET /api/v1/iam/my-permissions
Authorization: Bearer <accessToken>
```

> Uses JWT's `organizationId` and `applicationId`. No query params.

**Response `data`:**

```json
{
  "permissions": ["users:read", "users:write", "roles:read"]
}
```

---

### Get My Organizations

```
GET /api/v1/iam/my-organizations?applicationId=uuid
Authorization: Bearer <accessToken>
```

**Query Parameters:**

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `applicationId` | string (UUID) | No | Filter to organizations within a specific app |

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

> Aggregates all roles per org. If a user has multiple roles in the same org, they're all listed.

---

## Application Endpoints

### List Applications

```
GET /api/v1/applications
Authorization: Bearer <accessToken>
```

**Permission:** `applications:read`

**Response `data`:** Array of application objects (without `clientSecret`). Ordered by `createdAt` desc.

```json
[
  {
    "id": "uuid",
    "name": "pharmacy",
    "displayName": "Pharmacy App",
    "description": "...",
    "clientId": "uuid-client-id",
    "redirectUris": "[\"http://localhost:3000/callback\"]",
    "isActive": true,
    "createdAt": "...",
    "updatedAt": "..."
  }
]
```

> Note: `redirectUris` is stored as a JSON string.

---

### Get Application

```
GET /api/v1/applications/:id
Authorization: Bearer <accessToken>
```

**Permission:** `applications:read`

**Response `data`:** Single application object (without `clientSecret`).

---

### Create Application

```
POST /api/v1/applications
Authorization: Bearer <accessToken>
```

**Permission:** `applications:write`

**Request Body:**

```json
{
  "name": "pharmacy",
  "displayName": "Pharmacy App",
  "description": "Pharmacy management",
  "redirectUris": ["http://localhost:3000/callback"]
}
```

| Field | Type | Required | Validation | Description |
|-------|------|----------|------------|-------------|
| `name` | string | **Yes** | Non-empty, unique | Internal identifier |
| `displayName` | string | **Yes** | Non-empty | Human-readable |
| `description` | string | No | | |
| `redirectUris` | string[] | No | | OAuth redirect URIs |

**Response `data`:** Created application object **with plain-text `clientSecret`** (shown only once).

> Auto-generates `clientId` (UUID) and `clientSecret` (double UUID, bcrypt hashed in DB). The plain-text secret is returned **only on creation**.

**Error cases:**
- `400` — Application name already exists

---

### Update Application

```
PATCH /api/v1/applications/:id
Authorization: Bearer <accessToken>
```

**Permission:** `applications:write`

**Request Body:** (all optional)

```json
{
  "name": "pharmacy-v2",
  "displayName": "Pharmacy App V2",
  "description": "Updated",
  "redirectUris": ["http://localhost:3000/callback", "http://prod.example.com/callback"]
}
```

**Response `data`:** Updated application object (without `clientSecret`).

---

### Update Application Status (activate/deactivate)

```
PATCH /api/v1/applications/:id/status
Authorization: Bearer <accessToken>
```

**Permission:** `applications:write`

**Request Body:**

```json
{
  "isActive": false
}
```

**Response `data`:** Updated application object.

---

### Regenerate Client Secret

```
POST /api/v1/applications/:id/regenerate-secret
Authorization: Bearer <accessToken>
```

**Permission:** `applications:write`

**Response `data`:**

```json
{
  "clientSecret": "new-plain-text-secret-shown-once"
}
```

> Old secret invalidated immediately. Update downstream service env vars.

---

## Notification Endpoints

### Get Notifications (placeholder)

```
GET /api/v1/notifications
Authorization: Bearer <accessToken>
```

**Response `data`:**

```json
{
  "data": [],
  "message": "Notifications endpoint"
}
```

> Placeholder. Full implementation TBD.

---

### Push Real-Time Notification

```
POST /api/v1/notifications/push
Authorization: Bearer <accessToken>  (user or service token)
```

**Request Body — Push to specific user:**

```json
{
  "userId": "uuid-of-user",
  "event": "order.created",
  "data": {
    "orderId": "123",
    "status": "confirmed",
    "total": 50000
  }
}
```

**Request Body — Push to organization:**

```json
{
  "organizationId": "uuid-of-org",
  "event": "stock.low",
  "data": { "productName": "Paracetamol", "remainingStock": 5 }
}
```

**Request Body — Broadcast to all:**

```json
{
  "broadcast": true,
  "event": "system.maintenance",
  "data": { "message": "Maintenance at 22:00" }
}
```

| Field | Type | Required | Validation | Description |
|-------|------|----------|------------|-------------|
| `userId` | string | No | | Push to `user:{userId}` room |
| `organizationId` | string | No | | Push to `org:{orgId}` room |
| `broadcast` | boolean | No | | Push to ALL connected clients |
| `event` | string | **Yes** | Non-empty | Socket.IO event name |
| `data` | object | **Yes** | Must be object | Arbitrary JSON payload |

> At least one of `userId`, `organizationId`, or `broadcast: true` must be provided.

**Priority order:** broadcast > organizationId > userId

**Error cases:**
- `400` — Provide at least one target

---

### Mark Notification as Read

```
PATCH /api/v1/notifications/:id/read
Authorization: Bearer <accessToken>
```

**Response `data`:**

```json
{
  "message": "Notification marked as read"
}
```

---

### Mark All Notifications as Read

```
PATCH /api/v1/notifications/read-all
Authorization: Bearer <accessToken>
```

**Response `data`:**

```json
{
  "message": "All notifications marked as read"
}
```

---

## WebSocket (Real-Time)

Connect to `/ws` with Socket.IO, pass JWT in handshake:

```javascript
import { io } from 'socket.io-client';

const socket = io('http://localhost:3000/ws', {
  auth: { token: accessToken },
});
```

### Auto-Joined Rooms

Upon connection, the gateway verifies the JWT using the ES256 public key and auto-joins:

| Room | Condition | Purpose |
|------|-----------|---------|
| `user:{userId}` | Always (for user tokens) | Target specific user |
| `org:{organizationId}` | If `organizationId` in JWT | Target all users in org |
| `app:{applicationId}` | If `applicationId` in JWT | Target all users in app |

### Listening for Events

```javascript
socket.on('order.created', (payload) => {
  console.log(payload);
  // { orderId: "123", status: "confirmed", total: 50000 }
});
```

### Connection Errors

If the JWT is missing or invalid, the client is **immediately disconnected**.

---

## Storage Endpoints

### Upload File

```
POST /api/v1/storage/upload
Authorization: Bearer <accessToken>
Content-Type: multipart/form-data
```

**Max file size:** 10 MB  
**Form field:** `file` (binary)

**Business logic:**
- File is stored in MinIO at path `{organizationId}/general/{uuid}.{ext}`
- `organizationId` is extracted from the JWT

**Response `data`:**

```json
{
  "key": "uuid-org/general/uuid-file.pdf",
  "size": 102400,
  "mimeType": "application/pdf"
}
```

---

### Get Presigned Download URL

```
GET /api/v1/storage/:key/presign
Authorization: Bearer <accessToken>
```

**Response `data`:** Plain string URL (valid for 1 hour / 3600 seconds).

```
"https://minio.example.com/main-core/uuid-org/general/uuid-file.pdf?X-Amz-..."
```

---

### Delete File

```
DELETE /api/v1/storage/:key
Authorization: Bearer <accessToken>
```

**Permission:** `storage:delete`

**Response `data`:**

```json
{
  "deleted": true
}
```

---

## Audit Endpoints

> **Note:** Audit logging is currently **postponed**. The query endpoint works but no events are being recorded.

### Query Audit Logs (paginated)

```
GET /api/v1/audit?page=1&limit=20&userId=uuid&action=user.created&organizationId=uuid&startDate=2026-01-01&endDate=2026-12-31
Authorization: Bearer <accessToken>
```

**Permission:** `audit:read`

**Query Parameters:**

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `page` | integer | No | `1` | |
| `limit` | integer | No | `20` | |
| `userId` | string | No | | Filter by user |
| `action` | string | No | | Partial match (contains) |
| `organizationId` | string | No | | Filter by organization |
| `startDate` | string (ISO 8601) | No | | From date |
| `endDate` | string (ISO 8601) | No | | To date |

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
      "createdAt": "..."
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

## Health Endpoint

```
GET /api/v1/health
```

> **Public** — no auth required.

**Response `data`:**

```json
{
  "status": "ok",
  "info": {
    "database": { "status": "up" },
    "minio": { "status": "up" }
  },
  "error": {},
  "details": {
    "database": { "status": "up" },
    "minio": { "status": "up" }
  }
}
```

> Uses `@nestjs/terminus`. Checks PostgreSQL (via Prisma) and MinIO connectivity.

---

## Common HTTP Status Codes

| Code | Meaning |
|------|---------|
| 200 | Success |
| 201 | Created |
| 400 | Validation error / Bad request |
| 401 | Missing or invalid token |
| 403 | Insufficient permissions |
| 404 | Resource not found |
| 429 | Rate limited |
| 500 | Internal server error |

---

## Frontend Integration Checklist

- [ ] Store `accessToken` and `refreshToken` after login/register
- [ ] Add `Authorization: Bearer <token>` header to all API calls
- [ ] Implement token refresh before access token expires (15 min)
- [ ] On 401 response, attempt refresh; if refresh fails, redirect to login
- [ ] Extract tokens from URL params after Google OAuth callback
- [ ] Handle validation errors (400) by displaying `errors` array to user
- [ ] Handle rate limiting (429) gracefully
- [ ] Read `applicationId` from JWT payload for app-scoped UI behavior
- [ ] Read `organizationId` from JWT payload for org context
- [ ] Use `GET /iam/my-organizations` to build org switcher
- [ ] Use `POST /auth/switch-organization` to switch org context (get new tokens)
- [ ] Connect to WebSocket at `/ws` for real-time notifications
- [ ] Use `GET /iam/my-permissions` to conditionally show/hide UI elements
- [ ] Handle `applicationId` in register/login for app-scoped sessions
- [ ] After password reset, all existing sessions are invalidated (force re-login)
