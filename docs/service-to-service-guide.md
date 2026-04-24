# Service-to-Service API Guide

This guide explains how downstream services authenticate and communicate with the **main-core-service** API.

Base URL: `http://localhost:3000/api/v1`

---

## Overview

```
┌──────────────┐    ┌──────────────┐         ┌──────────────────────┐
│  Warehouse    │    │  Downstream   │  HTTP   │  main-core-service    │
│  Frontend     │    │  Service (e.g.│ ──────> │  (this service)       │
│              │    │  pharmacy-app)│ <────── │                       │
└──────┬───────┘    └──────────────┘         └──────────────────────┘
       │                    │
       │  user token        │  service token (for background ops)
       │  (from login)      │  (from POST /auth/token)
       ▼                    ▼
```

All login, registration, and JWT signing happens in main-core-service. Downstream services use tokens issued by main-core-service.

---

## Authentication Strategies

There are **two ways** a downstream service calls main-core-service. Choose based on the scenario.

### Strategy 1: Forward User Token (Recommended for user-initiated requests)

```
Warehouse FE  ──(user token)──>  Warehouse BE  ──(same user token)──>  Main Core Service
```

Since main-core-service signed the JWT, the token stays valid regardless of which service forwards it. The downstream BE simply passes the `Authorization` header through.

```typescript
// Warehouse BE — forward the user's token, no extra auth needed
async function getUsersList(req: Request) {
  const res = await fetch('http://main-core:3000/api/v1/users', {
    headers: { Authorization: req.headers.authorization },
  });
  return res.json();
}
```

**When to use:**
- Fetching data on behalf of a user (e.g. get user list, get organizations)
- Any user-initiated request where the user's permissions should be enforced
- When you want zero setup (no client credentials, no token management)

**Benefits:**
- User's permissions are automatically enforced — they only see what they're allowed to
- Organization context is preserved in the JWT
- No need to register the app or manage client credentials
- No extra token management code

### Strategy 2: Service Token (For background / system operations)

```
Warehouse BE  ──(service token from POST /auth/token)──>  Main Core Service
```

The service authenticates as itself using client credentials. No user involved.

```typescript
// Get a service token
const token = await getServiceToken();

// Use it
await fetch('http://main-core:3000/api/v1/notifications/push', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ userId, event, data }),
});
```

**When to use:**
- Push notifications (no user initiated the request)
- Background jobs / cron tasks
- System-level operations outside user authority
- Inter-service communication where no user context exists

### Decision Table

| Scenario | Strategy | Token Source |
|----------|----------|-------------|
| Warehouse FE asks for user list | Forward user token | FE → BE → main-core |
| Warehouse FE checks permissions | Forward user token | FE → BE → main-core |
| Cron job syncs data | Service token | BE → `POST /auth/token` |
| Push notification to user | Service token | BE → `POST /auth/token` |
| Background stock alert | Service token | BE → `POST /auth/token` |

---

## Strategy 1 Setup: Forward User Token

No setup needed on the downstream service. Just pass the `Authorization` header from the incoming request to the outgoing request to main-core-service.

```typescript
// Example: NestJS controller in warehouse BE
@Get('users')
async getUsers(@Req() req: Request) {
  const res = await fetch(`${coreServiceUrl}/users`, {
    headers: { Authorization: req.headers.authorization! },
  });
  return res.json();
}
```

The downstream BE can also verify the user token **locally** without calling main-core-service — see [Local JWT Verification](#local-jwt-verification-no-api-call-needed).

---

## Strategy 2 Setup: Service Token

### Step 1: Register Your Service

An admin must register your application in main-core-service first. This returns a `clientId` and `clientSecret` **once**.

```
POST /api/v1/applications
Authorization: Bearer <admin-accessToken>
```

**Request Body:**

```json
{
  "name": "pharmacy-app",
  "displayName": "Pharmacy Application",
  "description": "Pharmacy management module",
  "redirectUris": []
}
```

**Response `data`:**

```json
{
  "id": "app-uuid",
  "name": "pharmacy-app",
  "displayName": "Pharmacy Application",
  "description": "Pharmacy management module",
  "clientId": "generated-client-id",
  "clientSecret": "PLAIN_TEXT_SECRET_SHOWN_ONLY_ONCE",
  "redirectUris": [],
  "isActive": true,
  "createdAt": "...",
  "updatedAt": "..."
}
```

> **Important:** `clientSecret` is shown only at creation time. Store it securely.

### Step 2: Get a Service Token

```
POST /api/v1/auth/token
```

**Request Body:**

```json
{
  "clientId": "generated-client-id",
  "clientSecret": "PLAIN_TEXT_SECRET"
}
```

**Response `data`:**

```json
{
  "accessToken": "eyJhbGci...",
  "tokenType": "Bearer",
  "expiresIn": 900
}
```

### Step 3: Service Token Strategy — Fetch Per Call

Service tokens expire in **15 minutes**. For downstream services that rarely call main-core-service (e.g. push notification once a day), the simplest approach is to **fetch a fresh token every time** you need it:

```typescript
// No caching, no timers, no complexity
async function getServiceToken(): Promise<string> {
  const res = await fetch('http://main-core:3000/api/v1/auth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientId: process.env.CORE_CLIENT_ID,
      clientSecret: process.env.CORE_CLIENT_SECRET,
    }),
  });
  const json = await res.json();
  return json.data.accessToken;
}

// Use it — one extra HTTP call per request, negligible for infrequent calls
async function pushNotification(userId: string, event: string, data: Record<string, unknown>) {
  const token = await getServiceToken();
  return fetch('http://main-core:3000/api/v1/notifications/push', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ userId, event, data }),
  });
}
```

**Why fetch per call instead of caching:**

- If the service calls main-core-service once a day, caching a token in memory and checking expiry on every request is wasteful
- Zero memory overhead, no expiry tracking, no background processes
- One extra HTTP call per request is negligible for infrequent calls
- If the service becomes chatty later, add caching then

**Environment Variables:**

```env
CORE_SERVICE_URL=http://localhost:3000/api/v1
CORE_CLIENT_ID=your-client-id
CORE_CLIENT_SECRET=your-client-secret
```

---

## Push Notifications (WebSocket)

External services can push real-time notifications to connected users via WebSocket by calling the push endpoint. This uses **Strategy 2 (Service Token)**.

### Push a Notification

```
POST /api/v1/notifications/push
Authorization: Bearer <service-token>
Content-Type: application/json
```

**Request Body — Push to a specific user:**

```json
{
  "userId": "550e8400-e29b-41d4-a716-446655440000",
  "event": "order.created",
  "data": {
    "orderId": "ORD-123",
    "status": "confirmed",
    "total": 50000
  }
}
```

**Request Body — Push to all users in an organization:**

```json
{
  "organizationId": "org-uuid-here",
  "event": "stock.low",
  "data": {
    "productName": "Paracetamol 500mg",
    "remainingStock": 5,
    "threshold": 10
  }
}
```

**Request Body — Broadcast to all connected clients:**

```json
{
  "broadcast": true,
  "event": "system.maintenance",
  "data": {
    "message": "Scheduled maintenance at 22:00",
    "estimatedDowntime": "30 minutes"
  }
}
```

**Response `data`:**

```json
{
  "target": "user",
  "userId": "550e8400-e29b-41d4-a716-446655440000",
  "event": "order.created"
}
```

### Request Body Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `userId` | string | One of userId, organizationId, or broadcast | Target user ID — sends to WebSocket room `user:{userId}` |
| `organizationId` | string | One of userId, organizationId, or broadcast | Target org — sends to WebSocket room `org:{orgId}` |
| `broadcast` | boolean | One of userId, organizationId, or broadcast | If true, sends to ALL connected clients |
| `event` | string | Yes | Socket.IO event name (e.g. `order.created`, `stock.low`) |
| `data` | object | Yes | Arbitrary JSON payload to send with the event |

### How It Works End-to-End

```
1. Frontend users connect to WebSocket at /ws with their JWT token
2. main-core-service auto-joins each user into rooms: user:{userId} and org:{orgId}
3. Your service calls POST /notifications/push with a service token
4. main-core-service emits the event to the target room(s)
5. Connected frontend clients receive the event in real-time
```

### Frontend Receives the Event

```javascript
// On the frontend (Socket.IO client)
const socket = io('http://localhost:3000/ws', {
  auth: { token: userAccessToken },
});

socket.on('order.created', (payload) => {
  console.log(payload);
  // { orderId: "ORD-123", status: "confirmed", total: 50000 }
});

socket.on('stock.low', (payload) => {
  console.log(payload);
  // { productName: "Paracetamol 500mg", remainingStock: 5, threshold: 10 }
});
```

### Full Example: Warehouse BE Pushes Notification

```typescript
// warehouse-be/src/services/notification.service.ts

async function pushStockAlert(orgId: string, productName: string, stock: number) {
  const token = await getServiceToken();

  const res = await fetch('http://main-core:3000/api/v1/notifications/push', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      organizationId: orgId,
      event: 'stock.low',
      data: { productName, remainingStock: stock, threshold: 10 },
    }),
  });

  return res.json();
}

async function getServiceToken(): Promise<string> {
  const res = await fetch('http://main-core:3000/api/v1/auth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientId: process.env.CORE_CLIENT_ID,
      clientSecret: process.env.CORE_CLIENT_SECRET,
    }),
  });
  const json = await res.json();
  return json.data.accessToken;
}
```

---

## Other Service-to-Service Endpoints

### User Lookup (forward user token or use service token)

```bash
# Option A: Forward user token (user permissions enforced)
curl http://localhost:3000/api/v1/users/550e8400-e29b-41d4-a716-446655440000 \
  -H "Authorization: Bearer <user-access-token>"

# Option B: Service token (service's own permissions)
curl http://localhost:3000/api/v1/users/550e8400-e29b-41d4-a716-446655440000 \
  -H "Authorization: Bearer <service-access-token>"
```

### Organization Lookup (public — no auth needed)

```bash
curl http://localhost:3000/api/v1/organizations
curl http://localhost:3000/api/v1/organizations/slug/my-org
```

### Token Verification (validate a user's token)

```bash
curl http://localhost:3000/api/v1/auth/verify-token \
  -H "Authorization: Bearer <user-access-token>"
```

### Permission Check

```bash
curl "http://localhost:3000/api/v1/iam/check?permission=users:read&organizationId=org-uuid" \
  -H "Authorization: Bearer <access-token>"
```

### Health Check

```bash
curl http://localhost:3000/api/v1/health
```

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
  "path": "/api/v1/notifications/push"
}
```

### Error

```json
{
  "statusCode": 401,
  "message": "Unauthorized",
  "errors": null,
  "timestamp": "...",
  "path": "/api/v1/notifications/push"
}
```

### Error Handling

| Status | Meaning | Action |
|--------|---------|--------|
| 400 | Bad request (missing target, invalid body) | Fix request body |
| 401 | Token expired or invalid | Get a fresh token |
| 403 | Insufficient permissions | Check assigned roles/permissions |
| 429 | Rate limited | Retry with backoff |

---

## Local JWT Verification (No API Call Needed)

Downstream services can verify user JWTs **locally** without calling main-core-service. The tokens are signed with ES256 (ECDSA P-256). This works for both user tokens and service tokens.

### Token Structure

**User token:**

```
Header:  { "alg": "ES256", "typ": "JWT" }
Payload: {
  "sub": "user-uuid",
  "email": "john@example.com",
  "type": "user",
  "organizationId": "org-uuid",
  "roles": ["org_admin"],
  "iat": 1713945600,
  "exp": 1713946500
}
```

**Service token:**

```
Header:  { "alg": "ES256", "typ": "JWT" }
Payload: {
  "sub": "pharmacy-app",
  "type": "service",
  "applicationId": "app-uuid",
  "permissions": ["inventory:read", "inventory:write"],
  "iat": 1713945600,
  "exp": 1713946500
}
```

### How to Verify Locally

1. Get the **JWT_PUBLIC_KEY** from main-core-service admin (PEM format)
2. Set it as an environment variable in your downstream service
3. Verify tokens using any JWT library:

```typescript
import * as jwt from 'jsonwebtoken';

const publicKey = process.env.JWT_PUBLIC_KEY.replace(/\\n/g, '\n');
const payload = jwt.verify(token, publicKey, { algorithms: ['ES256'] });

if (payload.type === 'user') {
  // payload.sub = user ID
  // payload.organizationId = current org context
  // payload.roles = role names in this org
}

if (payload.type === 'service') {
  // payload.sub = application name
  // payload.applicationId = application ID
  // payload.permissions = granted permissions
}
```

### When to Call API vs. Local Verification

| Scenario | Approach |
|----------|----------|
| Verify if a token is valid | **Local** — use the public key |
| Get user details (name, email, etc.) | **API call** — `GET /users/:id` |
| Check fine-grained permissions | **API call** — `GET /iam/check` |
| Push notification to user/org | **API call** — `POST /notifications/push` (service token) |
| Get user's organizations | **API call** — `GET /iam/my-organizations` |
| Health check | **API call** — `GET /health` |

---

## Regenerating Client Secret

If the secret is compromised:

```
POST /api/v1/applications/:id/regenerate-secret
Authorization: Bearer <admin-accessToken>
```

> The old secret is invalidated immediately. Update your downstream service env vars.
