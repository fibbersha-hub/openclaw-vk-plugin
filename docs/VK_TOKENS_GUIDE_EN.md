# OpenClaw VK Plugin — Official SDK Documentation

## 1. Overview

The OpenClaw VK Plugin enables programmatic interaction with the VK API on behalf of a community.

It provides:

- Inbound message handling (Bots Long Poll / Callback API)
- Outbound messaging (text, keyboards)
- Media upload (images, documents)
- Wall publishing
- VK Market operations

---

## 2. Requirements

### Mandatory parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `token` | `string` | VK Community Access Token |
| `groupId` | `string` | Numeric community identifier |

---

## 3. Authentication

### 3.1 Token type

The plugin uses a **Community Access Token**.

Token format:
```
vk1.a.<token>
```

### 3.2 Community token capabilities

The token **MUST** have the following minimum scope:

| Scope | Required | Purpose |
|-------|----------|---------|
| `messages` | ✅ Yes | Receive and send messages |

Optional scopes (per official VK API documentation):

| Scope | Purpose |
|-------|---------|
| `photos` | Upload images |
| `docs` | Upload files |
| `stories` | Publish stories |
| `wall` | Publish posts on behalf of the community |
| `app_widget` | Community app widgets |
| `manage` | Extended API access (stats, Callback) |

> **Important — `market`:** This scope is **not available** on community tokens. VK Market methods (`market.get`, `market.edit`, etc.) require a separate **User Access Token** — see section 3.3.

### 3.3 User Access Token for VK Market

All `market.*` methods (market.get, market.edit, market.add, etc.) require a **User Access Token** — a community token will not work.

To obtain a user token with Market access:

1. Create a **Standalone application** in the [VK ID Authorization Service](https://id.vk.com/business/go) (since April 10, 2026, Standalone apps can only be created there)
2. Request `market` scope (value: `134217728`) via OAuth Implicit Flow:
   ```
   https://oauth.vk.com/authorize?client_id=YOUR_APP_ID&display=page
     &redirect_uri=https://oauth.vk.com/blank.html
     &scope=134217728&response_type=token&v=5.199
   ```
3. The token is returned in the redirect URL fragment: `#access_token=vk1.a...`

> **Important:** The `market` scope for applications created via VK ID Authorization Service requires explicit approval. Send a request to `devsupport@corp.vk.com` specifying your app ID and community ID. See [dev.vk.com/reference/access-rights](https://dev.vk.com/reference/access-rights).

---

### 3.4 Token lifecycle

The token:

- Has no fixed expiration time
- Remains valid until:
  - Explicitly revoked
  - Permissions are changed
  - A security reset occurs

> **Important:** The token is displayed only once at creation. It cannot be retrieved later. If lost, generate a new token.

### 3.4 Security requirements

### 3.5 Security requirements

**MUST:**
- Store tokens in a secure location (environment variables or secret manager)
- Restrict access to configuration files
- Prevent token exposure in logs or client-side code

**MUST NOT:**
- Commit tokens to version control
- Share tokens in plaintext
- Embed tokens in frontend applications

---

## 4. Community Configuration

Before using the plugin, configure the following VK community settings.

### 4.1 Enable Bots Long Poll API

```
Manage → Messages → Bot settings → Enable Long Poll API
```

### 4.2 Allow messages

```
Manage → Messages → Bot settings → Allow messages from community
```

### 4.3 Production recommendation

- Long Poll API is suitable for development and low-load environments
- For production systems, **Callback API** (webhooks) **SHOULD** be used:
  ```
  Manage → Messages → Callback API → Set server URL
  ```

---

## 5. Group ID

### 5.1 Definition

`groupId` is the numeric identifier of the VK community.

### 5.2 Constraints

- **MUST** be numeric
- **MUST NOT** include a minus sign
- **MUST NOT** be a screen name (e.g. `my_community`)

> **LongID:** VK is migrating all identifiers (user_id, group_id, owner_id) from Int32 to Int64. Values may exceed 2,147,483,647. The plugin accepts `groupId` as a **string** — this is the correct format, fully compatible with Int64.

### 5.3 Retrieval

**Method 1 — VK UI:**
```
Manage → API usage → Community ID field
```
If the field is not visible: **Manage → General → Page address** — use the number after `club`.

**Method 2 — API:**

```bash
curl "https://api.vk.com/method/groups.getById?group_id=SHORT_NAME&access_token=TOKEN&v=5.199"
```

Query parameters:

| Param | Required |
|-------|----------|
| `group_id` | ✅ Yes |
| `access_token` | Optional |
| `v` | ✅ Yes |

Example response:
```json
{
  "response": [
    {
      "id": 123456789,
      "name": "Community name"
    }
  ]
}
```

Use the `id` value.

---

## 6. Configuration

### 6.1 JSON configuration

File: `openclaw.json`

```json
{
  "plugins": {
    "entries": {
      "vk": {
        "token": "vk1.a.YOUR_TOKEN",
        "groupId": "123456789"
      }
    }
  }
}
```

> `groupId` is passed as a string — this is the expected format for the plugin.

### 6.2 Environment variables (recommended)

```env
VK_TOKEN=vk1.a.YOUR_TOKEN
VK_GROUP_ID=123456789
```

### 6.3 UI configuration

```
Settings → Channels → VK → Configure
```

---

## 7. Runtime Behavior

### 7.1 Event ingestion

The plugin supports two modes:

| Mode | Description |
|------|-------------|
| Long Poll | Pull-based event retrieval |
| Callback API | Webhook-based event delivery |

### 7.2 Message flow

```
Event received from VK
       ↓
Event parsed
       ↓
Handler executed
       ↓
Response sent via API
```

---

## 8. Verification

### 8.1 Functional check

Send a message to the community.

Expected behavior:
1. Plugin receives the event
2. Response is generated
3. Reply is sent

### 8.2 API check

```bash
curl "https://api.vk.com/method/groups.getById?group_id=123456789&access_token=vk1.a.TOKEN&v=5.199"
```

Expected response:
```json
{
  "response": [
    {
      "id": 123456789,
      "name": "Community name"
    }
  ]
}
```

---

## 9. Error Handling

### 9.1 Common error codes

| Code | Description | Action |
|------|-------------|--------|
| `5` | Invalid token | Regenerate token |
| `7` | Permission denied | Adjust scopes |
| `10` | Internal VK error | Retry with backoff |
| `15` | Access denied | Check permissions |
| `18` | User or community deleted/banned, or token invalid | Verify community status, regenerate token |
| `100` | Invalid parameter | Validate `groupId` and request params |

### 9.2 Retry strategy

Recommended:
- Exponential backoff
- Max retries: 3–5
- Jitter enabled

---

## 10. Rate Limits

VK API enforces per-token request limits.

Recommendations:
- Implement request throttling
- Queue outbound requests
- Avoid burst traffic

---

## 11. Production Guidelines

**MUST:**
- Use Callback API for production workloads
- Implement retry logic
- Log all API interactions (excluding sensitive data)
- Monitor error rates

**SHOULD:**
- Use separate tokens per environment (dev / staging / production)
- Rotate tokens periodically
- Implement alerting on error spikes

---

## 12. Security

### 12.1 Token storage

Use:
- Environment variables
- Secret managers (Vault, AWS Secrets Manager, etc.)

### 12.2 Access control

- Restrict configuration file permissions
- Isolate the runtime environment
- Avoid shared credentials across services

### 12.3 Incident response

If a token is compromised:

1. Revoke the token immediately
2. Issue a new token
3. Update all configurations
4. Review logs for misuse

---

## 13. Limitations

- Long Poll may lose events under unstable network conditions
- Callback API requires a publicly accessible HTTPS endpoint
- VK API behavior may change across versions — test after upgrades
- VK Market methods are not accessible via community token — a User Access Token with `market` scope is required
- The `market` scope for new VK ID applications is granted only after approval by VK support (devsupport@corp.vk.com)

---

## 14. API Versioning

All examples use:
```
v=5.199
```

Always use the latest stable VK API version. See [dev.vk.com/versions](https://dev.vk.com/versions).

---

## 15. Pre-Deployment Checklist

- [ ] Token generated
- [ ] Required scopes assigned (minimum: `messages`)
- [ ] `groupId` validated (numeric, no minus sign)
- [ ] Long Poll or Callback API configured in community settings
- [ ] Messaging enabled on behalf of the community
- [ ] Configuration applied (`openclaw.json` or UI)
- [ ] Test message successful
