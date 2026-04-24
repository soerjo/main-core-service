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
  "errors": null,
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
| Access Token | 15 min (configurable) | Authenticate API requests |
| Refresh Token | 7 days (configurable) | Get a new access token |

### JWT Payload (decoded access token for users)

```json
{
  "sub": "user-uuid",
  "email": "john@example.com",
  "type": "user",
  "organizationId": "org-uuid",
  "roles": ["org_admin"],
  "iat": 1713945600,
  "exp": 1713946500
}
```

---

## Auth Endpoints

### Register

```
POST /api/v1/auth/register
```

**Request Body:**

```json
{
  "email": "john@example.com",
  "password": "Str0ng!Pass1",
  "firstName": "John",
  "lastName": "Doe"
}
```

**Password rules:** min 8 characters, at least one uppercase, one lowercase, one number.

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
    "isActive": true,
    "createdAt": "...",
    "updatedAt": "..."
  }
}
```

> Registration auto-creates an organization and assigns the `org_admin` role.

---

### Login

```
POST /api/v1/auth/login
```

**Request Body:**

```json
{
  "email": "john@example.com",
  "password": "Str0ng!Pass1"
}
```

**Response `data`:**

```json
{
  "accessToken": "eyJhbGci...",
  "refreshToken": "a1b2c3d4..."
}
```

> Rate limited: 5 requests per minute per IP.
> Account lockout: 5 failed attempts = 15-minute lock.

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

> Old refresh token is invalidated. Rotation-based — store the new token each time.

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
    "id": "uuid",
    "email": "john@example.com",
    "firstName": "John",
    "lastName": "Doe",
    "avatarUrl": null,
    "phone": null,
    "isActive": true,
    "organizationId": "uuid",
    "roles": ["org_admin"]
  }
}
```

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

**Response `data`:**

```json
{
  "message": "Logged out successfully"
}
```

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

> The new access token will contain the target `organizationId` and roles for that org.

---

### Forgot Password

```
POST /api/v1/auth/forgot-password
```

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

> Rate limited: 3 requests per minute.

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

**Response `data`:**

```json
{
  "message": "Password reset successfully"
}
```

---

### Change Password (authenticated)

```
POST /api/v1/auth/change-password
Authorization: Bearer <accessToken>
```

**Request Body:**

```json
{
  "currentPassword": "OldPass123",
  "newPassword": "NewStr0ng!Pass1"
}
```

**Response `data`:**

```json
{
  "message": "Password changed successfully"
}
```

---

### Set Password (for OAuth users)

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

---

## Google OAuth Flow

```
1. Frontend redirects user to: GET /api/v1/auth/google
2. User authenticates with Google
3. Google redirects back to: GET /api/v1/auth/google/callback
4. Server redirects to: {FRONTEND_URL}/auth/google/callback?accessToken=...&refreshToken=...
5. Frontend extracts tokens from URL query params
```

---

## User Endpoints

### Get Current User Profile

```
GET /api/v1/users/me
Authorization: Bearer <accessToken>
```

**Response `data`** — user object with roles and organization memberships.

---

### Update Profile

```
PATCH /api/v1/users/me
Authorization: Bearer <accessToken>
```

**Request Body:**

```json
{
  "firstName": "Jane",
  "lastName": "Smith",
  "phone": "+1234567890"
}
```

---

### List Users (admin)

```
GET /api/v1/users?page=1&limit=20
Authorization: Bearer <accessToken>
```

> Requires `users:read` permission.

---

### Get User by ID (admin)

```
GET /api/v1/users/:id
Authorization: Bearer <accessToken>
```

> Requires `users:read` permission. `:id` must be a valid UUID.

---

## Organization Endpoints

### List Organizations

```
GET /api/v1/organizations
```

> Public — no auth required.

### Get My Organizations

```
GET /api/v1/iam/my-organizations
Authorization: Bearer <accessToken>
```

---

### List Org Members

```
GET /api/v1/organizations/:id/members
Authorization: Bearer <accessToken>
```

> Requires `organizations:read` permission.

---

## IAM Endpoints

### Check Permission

```
GET /api/v1/iam/check?permission=users:write&organizationId=org-uuid
Authorization: Bearer <accessToken>
```

---

### Get My Permissions

```
GET /api/v1/iam/my-permissions
Authorization: Bearer <accessToken>
```

---

## Notifications

### Get Notifications

```
GET /api/v1/notifications
Authorization: Bearer <accessToken>
```

---

### WebSocket (Real-time Notifications)

Connect to `/ws` with Socket.IO, pass JWT in handshake:

```javascript
import { io } from 'socket.io-client';

const socket = io('http://localhost:3000/ws', {
  auth: { token: accessToken },
});
```

---

## Storage / File Upload

### Upload File

```
POST /api/v1/storage/upload
Authorization: Bearer <accessToken>
Content-Type: multipart/form-data
```

**Form field:** `file`

---

### Get Presigned Download URL

```
GET /api/v1/storage/:key/presign
Authorization: Bearer <accessToken>
```

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
