# Claude Desktop third-party deployment with Vortex SSO

This guide deploys Claude Desktop in third-party inference mode against the
Vortex SSO bootstrap server. The server uses the OAuth device-code flow, so one
browser sign-in supplies both the user's managed configuration and their
inference authorization. Devices receive no LiteLLM credentials.

Claude Desktop 1.10628.0 or later is required for bootstrap configuration.
Silent token refresh while the app is running requires 1.34493.0 or later.
The managed plugin marketplace requires Claude Desktop 1.32352.0 or later.

```text
Claude Desktop
  |
  | RFC 8414 discovery and RFC 8628 device authorization
  v
api.auth-dev.vortex.so  <---->  auth.auth-dev.vortex.so
  |                            sign-in and consent UI
  | /user/bootstrap
  | /v1/messages, /v1/messages/count_tokens, /v1/models
  | /claude/plugins/marketplace.json, /claude/plugins/archives/*.zip
  v
llm-manager.fly.dev
  LiteLLM proxy, using a server-held key owned by the signed-in user

console.auth-dev.vortex.so
  admin access, profile assignment, users, and session revocation
```

See Anthropic's [bootstrap server documentation](https://claude.com/docs/third-party/claude-desktop/bootstrap)
for the client protocol and security model.

## Architecture

| Host | Role |
| --- | --- |
| `https://api.auth-dev.vortex.so` | Cloudflare Worker running Better Auth, bootstrap authorization, and the inference gateway |
| `https://auth.auth-dev.vortex.so` | User sign-in and device consent UI |
| `https://console.auth-dev.vortex.so` | Administrator console |
| `https://llm-manager.fly.dev` | Upstream LiteLLM proxy |

The API Worker exposes:

| Endpoint | Purpose |
| --- | --- |
| `/.well-known/oauth-authorization-server` | RFC 8414 authorization server discovery |
| `/oauth/device` | RFC 8628 device authorization request |
| `/oauth/token` | Device-code polling and refresh-token exchange |
| `/device` | Same-origin verification entry point, redirected to `https://auth.auth-dev.vortex.so/auth/device` |
| `/user/bootstrap` | Per-user Claude Desktop configuration |
| `/v1/messages` | Streaming and non-streaming inference |
| `/v1/messages/count_tokens` | Token counting |
| `/v1/models` | Model discovery |
| `/claude/plugins/marketplace.json` | Authenticated Vortex plugin marketplace manifest |
| `/claude/plugins/archives/:file` | Authenticated immutable plugin archive download |

The bootstrap URL and inference gateway share the API origin. This lets Claude
Desktop reuse the same device-code sign-in for configuration and inference.

## Access and revocation

Access is limited to:

1. Users an administrator has assigned a bootstrap profile to in the console,
   under the user record's profile assignment.
2. Administrators, who receive the default profile.

All other authenticated users receive `403 not_entitled` from
`/user/bootstrap`. The inference gateway also returns `403`, and refresh-token
requests are refused.

Banning a user removes access immediately. Revoking that user's sessions in the
console also ends Claude Desktop access because refresh tokens are tied to the
Better Auth session.

## Inference and per-user LiteLLM keys

On a user's first inference request, the Worker:

1. Finds the LiteLLM user with the same email address.
2. Creates the LiteLLM user if none exists, without sending an invitation.
3. Generates a virtual key owned by that LiteLLM user. Its alias is
   `vortex-sso:<userId>:<nonce>`.
4. Stores the key encrypted in D1 table `litellm_user_key`.
5. Forwards inference requests to LiteLLM with that key.

The stored key uses AES-256-GCM. Its encryption key is derived with HKDF from
`LITELLM_KEY_ENCRYPTION_SECRET` (falls back to `BETTER_AUTH_SECRET` when unset).
The LiteLLM key never reaches Claude Desktop. If the encryption secret changes,
stored keys can no longer be decrypted; the server then deletes them in LiteLLM
and provisions new ones on the next request.

Generated keys have no budget or model limits. Set per-user budgets and model
limits in the LiteLLM UI. Deleting a user through the Vortex console deletes
their LiteLLM key. If LiteLLM reports a key as deleted or blocked, the failing
request returns a retryable `502` and the server provisions a replacement key
for the retry.

## Sign-in lifetime

Access tokens last 7 days. Claude Desktop 1.34493.0 and later renews an access
token silently while the app is running by using a refresh token.

Refresh tokens also last 7 days and rotate on every use. Reuse detection
revokes the whole sign-in. If Claude Desktop remains closed past access-token
expiry, the user signs in again at the next launch.

## Device setup

Use only `bootstrapUrl` as the bootstrap authentication anchor. Never set
`bootstrapOidc` for this deployment. The server runs device-code mode itself.

Keep both restriction keys in every device configuration:

```json
{
  "bootstrapUrl": "https://api.auth-dev.vortex.so/user/bootstrap",
  "deploymentMode": "3p",
  "disableDeploymentModeChooser": true
}
```

`deploymentMode: "3p"` stops users from signing in to Claude.ai or moving the
device into an Enterprise Admin Console organization. Keep
`disableDeploymentModeChooser: true` for Claude Desktop versions earlier than
4.16336.0, which don't read `deploymentMode`.

Anthropic's [MDM guide](https://claude.com/docs/third-party/claude-desktop/mdm)
and [configuration reference](https://claude.com/docs/third-party/claude-desktop/configuration)
describe the supported policy locations and precedence.

### macOS

Deploy [`templates/macos-claude-3p.mobileconfig`](templates/macos-claude-3p.mobileconfig)
through MDM as a system configuration profile. Replace both placeholder UUIDs
with newly generated uppercase UUIDs before distribution.

The profile writes forced managed preferences in the
`com.anthropic.claudefordesktop` domain. Values inside
`mcx_preference_settings` must be strings, including the value `"true"`.
Equivalent MDM custom-settings payloads can use the same domain and values.

### Windows

Deploy [`templates/windows-claude-3p.reg`](templates/windows-claude-3p.reg) as
administrator or translate it into your device-management policy:

```text
HKEY_LOCAL_MACHINE\SOFTWARE\Policies\Claude
```

All three values are `REG_SZ` strings, including `"true"`. Machine policy under
HKLM wins. When HKLM has Claude policy values, Claude Desktop ignores HKCU
policy values.

### Linux

Install [`templates/linux-managed-settings.json`](templates/linux-managed-settings.json)
as:

```text
/etc/claude-desktop/managed-settings.json
```

The file uses JSON booleans, not strings. It must be owned by root and must not
be group-writable or world-writable. One suitable installation command is:

```bash
sudo install -o root -g root -m 0644 \
  docs/templates/linux-managed-settings.json \
  /etc/claude-desktop/managed-settings.json
```

### Without device management

Give the user [`templates/import-config.json`](templates/import-config.json).
In Claude Desktop, open **Developer > Configure Third-Party Inference... >
Import configuration** and select the file.

Imported configuration is user-controlled and doesn't carry the same trust as
machine-scoped management. The next section explains the resulting consent
dialog.

## Consent for bootstrap-delivered settings

Some settings delivered by a bootstrap response require user approval when the
bootstrap URL came from an imported file or user-scope registry policy. This
includes `inferenceGatewayBaseUrl`, which the Vortex server always returns.
Machine-scoped MDM, HKLM policy, and Linux managed settings are trusted by
default.

To suppress the dialog for an imported file, add this device-only key:

```json
{
  "bootstrapUrl": "https://api.auth-dev.vortex.so/user/bootstrap",
  "deploymentMode": "3p",
  "disableDeploymentModeChooser": true,
  "trustBootstrapDelivery": true
}
```

Set `trustBootstrapDelivery: true` only when you trust the Vortex bootstrap
server as much as device management. It allows consent-gated settings from that
server to apply without user review. The checked-in import template omits this
key so the choice stays explicit. The console profile editor lists which
profile keys are consent-gated.

## Bootstrap profiles

Profiles use the flat v1 format and should state `$schemaVersion: 1`. They are
validated against the vendored official schema at
`packages/schema/schemas/bootstrap-config-v1.schema.json`.

```json
{
  "$schemaVersion": 1,
  "inferenceProvider": "gateway",
  "desktopHome": "standard"
}
```

Unknown keys are rejected. Nested v2 profiles aren't supported. Refresh the
vendored schema with:

```bash
pnpm --filter @vortex/schema update-schema
```

The server always adds `inferenceGatewayBaseUrl` and `expiresAt`. A
bootstrap-settable key omitted by the selected profile is unset on the device,
not inherited from MDM.

Most profile changes require Claude Desktop to relaunch. The app re-checks the
bootstrap configuration every 10 minutes by default, controlled by
`configRecheckIntervalMinutes`. After a confirmed change, it enforces relaunch
after `relaunchEnforcementHours`, which defaults to 24 hours.

## Distributing MCP tools

Grant MCP servers per bootstrap profile with `managedMcpServers`. For a server
hosted behind the Vortex LiteLLM gateway, use the auth-server MCP URL and do not
write an `Authorization` header into the stored profile:

```json
{
  "$schemaVersion": 1,
  "inferenceProvider": "gateway",
  "managedMcpServers": [
    {
      "name": "meta-ads",
      "transport": "http",
      "url": "https://api.auth-dev.vortex.so/mcp/meta_ads_mcp"
    }
  ]
}
```

The bootstrap server injects a stable, per-user MCP bearer token into the
entry's static `headers.Authorization` field. Static MCP headers are not
consent-gated, but Claude Desktop applies header changes only after an app
relaunch. The token is deterministic for the user and token version, so normal
session refreshes do not change the profile or its ETag.

Servers that provide their own OAuth flow stay direct and are not modified by
the gateway injection:

```json
{
  "name": "posthog",
  "transport": "http",
  "url": "https://posthog.vortex.so/mcp",
  "oauth": true
}
```

Add only the MCP entries a profile's users may access. The gateway resolves the
assigned profile strictly, or the default profile only for an active admin, and
requires the raw URL to be the exact canonical
`https://api.auth-dev.vortex.so/mcp/<server>` form. Removing an entry from the
profile prevents new gateway requests even if a device still has the old static
header.

Set these MCP-specific Worker values:

| Variable | Purpose |
| --- | --- |
| `LITELLM_MCP_ACCESS_GROUP` | LiteLLM MCP access group granted to newly generated per-user virtual keys; use `vortex-claude-desktop` |
| `MCP_TOKEN_SECRET` | Worker secret used only for MCP HMAC bearer tokens; must be at least 32 random characters |

The MCP gateway returns `503` and bootstrap omits token injection when
`MCP_TOKEN_SECRET` is missing or shorter than 32 characters. It never falls
back to `BETTER_AUTH_SECRET`.

Inference and MCP use purpose-separated LiteLLM virtual keys. The inference key
has no MCP object permissions. The MCP key is provisioned automatically on the
user's first MCP request, receives `LITELLM_MCP_ACCESS_GROUP`, and is denied
default model access so it cannot be used as an inference credential.

Apply D1 migrations `0007_mcp_token_version.sql` and
`0008_litellm_mcp_key.sql` before enabling the gateway.

To revoke a user's distributed MCP token, send an authenticated,
non-impersonated admin request from the strict console origin:

```text
POST /admin/users/<user-id>/mcp-token/rotate
Origin: https://console.auth-dev.vortex.so
```

The route increments the user's token version and writes audit action
`admin.mcp_token.rotate`. Existing tokens fail immediately; relaunch Claude
Desktop after the next bootstrap refresh so it loads the newly injected token.

## Plugin marketplace (skills)

Vortex skills are distributed from the same API origin as bootstrap and
inference. Claude Desktop sends its existing device-session credential as
`Authorization: Bearer <token>` to both the marketplace manifest and every
archive URL, so users do not complete a second sign-in.

```text
github.com/vortex-so/claude-marketplace
  |
  | release workflow: build ZIPs, calculate SHA-256, publish archives, publish manifest
  v
https://api.auth-dev.vortex.so/claude/plugins/_publish/*
  |
  | MARKETPLACE_PUBLISH_TOKEN (CI secret matched by Worker secret)
  v
Cloudflare KV (PLUGINS_KV)
  |
  | authenticated manifest and archive reads
  v
Claude Desktop
```

Add this entry to the managed profile's `allowedPluginMarketplaces` array:

```json
{
  "source": "url",
  "url": "https://api.auth-dev.vortex.so/claude/plugins/marketplace.json",
  "credentialKind": "inferenceCredential",
  "expectedName": "vortex-marketplace",
  "installationPreference": "available"
}
```

`credentialKind: "inferenceCredential"` makes Desktop reuse the same bearer
credential it sends to `/v1`. The marketplace manifest itself may set an
individual plugin's `installationPreference` to `"auto_install"`. That is
allowed because this marketplace is served from the trusted bootstrap and
gateway origin; the profile-level `"available"` value does not prevent those
per-plugin automatic installations.

Each archive is an immutable ZIP containing `.claude-plugin/plugin.json` at
the ZIP root or under one wrapping directory. Skills that invoke scripts run
inside Claude Cowork or Claude Code. MCP server declarations are stripped from
the Claude Desktop plugin build; MCP servers belong in bootstrap profiles under
`managedMcpServers`, where Vortex can apply per-user gateway authorization.

Publishing is CI-only. Generate one random value of at least 32 characters and
set the same value in both locations:

```bash
# Cloudflare Worker secret (run from apps/auth-server)
pnpm exec wrangler secret put MARKETPLACE_PUBLISH_TOKEN

# GitHub Actions secret in vortex-so/claude-marketplace
gh secret set MARKETPLACE_PUBLISH_TOKEN --repo vortex-so/claude-marketplace
```

The release workflow uploads each archive with `x-content-sha256` and an exact
`Content-Length`, then uploads the manifest with its exact `Content-Length`
only after every referenced archive exists with matching KV metadata. Archives
are limited to 24 MiB and manifest bodies to 1 MiB. Archive downloads stream
directly from KV using the stored size metadata; neither the manifest nor
archive download endpoints redirect or cache user-specific responses.

## Operating the service

### Configuration

Set non-secret Worker values in `apps/auth-server/wrangler.jsonc`:

| Variable | Value or requirement |
| --- | --- |
| `PUBLIC_ORIGIN` | `https://api.auth-dev.vortex.so` |
| `INFERENCE_GATEWAY_BASE_URL` | API origin without `/v1` |
| `LITELLM_BASE_URL` | `https://llm-manager.fly.dev` |
| `LITELLM_MCP_ACCESS_GROUP` | `vortex-claude-desktop` |
| `AUTH_WEB_ORIGIN` | `https://auth.auth-dev.vortex.so` |

Set these as Worker secrets:

| Secret | Purpose |
| --- | --- |
| `BETTER_AUTH_SECRET` | Better Auth signing secret (must be non-empty, 32+ random characters) |
| `LITELLM_KEY_ENCRYPTION_SECRET` | Input key material for encrypting stored per-user LiteLLM keys (32+ random characters) |
| `MCP_TOKEN_SECRET` | HMAC secret for stable per-user MCP gateway tokens (32+ random characters; no fallback) |
| `MARKETPLACE_PUBLISH_TOKEN` | CI-only bearer token for publishing plugin archives and manifests (32+ random characters; no fallback) |
| `LITELLM_ADMIN_KEY` | LiteLLM proxy-admin key (can create users and keys) |
| `POSTMARK_*` | Postmark credentials and sender settings used by the auth flow |

### Rotating `BETTER_AUTH_SECRET`

The Worker refuses to start with an empty, short (< 32 chars) or Better Auth default secret.
Rotation signs every browser user out; Claude Desktop device tokens keep working.

1. `wrangler versions upload`, then `wrangler versions secret put BETTER_AUTH_SECRET` (creates a new version).
   Set `BETTER_AUTH_SECRET_PREVIOUS` to the old value only if the old value was a real secret, so encrypted data stays readable.
2. `wrangler versions deploy <new-version>@100%` and wait until `wrangler deployments status` shows only the new version.
3. Only then delete the JWT signing keys if they were encrypted with an unrecoverable secret:
   `wrangler d1 execute evolve-ai-bootstrap-dev --remote --command 'DELETE FROM "jwks";'`.
   Deleting earlier lets an old instance regenerate a key with the old secret, and every
   `get-session` then fails with "Failed to decrypt private key".
4. Check `curl https://api.auth-dev.vortex.so/api/auth/jwks`, then sign in and call `/api/auth/get-session`.

### Migrate and deploy

Apply remote D1 migrations before deploying code that depends on them:

```bash
pnpm --filter @vortex/auth-server run db:migrate:remote
pnpm --filter @vortex/auth-server run deploy
pnpm --filter @vortex/console run deploy
```

### Verify the deployment

Check discovery metadata:

```bash
curl -fsS \
  https://api.auth-dev.vortex.so/.well-known/oauth-authorization-server | jq
```

Start a device authorization:

```bash
curl -fsS -X POST https://api.auth-dev.vortex.so/oauth/device \
  -H 'content-type: application/x-www-form-urlencoded' \
  --data 'client_id=claude-desktop&scope=openid+offline_access+bootstrap:read' | jq
```

Confirm that the same-origin verification route sends the browser to the auth
web application:

```bash
curl -sSI 'https://api.auth-dev.vortex.so/device?user_code=ABCD-EFGH'
# Expected Location: https://auth.auth-dev.vortex.so/auth/device?...
```

Check bootstrap authorization states:

```bash
# 401, missing or invalid bearer
curl -si https://api.auth-dev.vortex.so/user/bootstrap

# 403 not_entitled, valid bearer for a user without a profile
curl -si https://api.auth-dev.vortex.so/user/bootstrap \
  -H "authorization: Bearer $UNENTITLED_ACCESS_TOKEN"

# 200, valid bearer for an assigned user or administrator
curl -si https://api.auth-dev.vortex.so/user/bootstrap \
  -H "authorization: Bearer $ACCESS_TOKEN"
```

Check streaming inference with an entitled access token:

```bash
curl -N https://api.auth-dev.vortex.so/v1/messages \
  -H "authorization: Bearer $ACCESS_TOKEN" \
  -H 'content-type: application/json' \
  -H 'anthropic-version: 2023-06-01' \
  --data '{
    "model": "claude-sonnet-4-5",
    "max_tokens": 32,
    "stream": true,
    "messages": [{"role": "user", "content": "Reply with OK"}]
  }'
```

For the full client workflow, see Anthropic's
[installation guide](https://claude.com/docs/third-party/claude-desktop/installation)
and [gateway guide](https://claude.com/docs/third-party/claude-desktop/gateway).

## Troubleshooting

### Logs and diagnostics

| Platform | Main log |
| --- | --- |
| macOS | `~/Library/Logs/Claude-3p/main.log` |
| Windows | `%LOCALAPPDATA%\Claude-3p\Logs\main.log` |
| Linux | `~/.config/Claude-3p/logs/` |

In Claude Desktop, open **Help > Troubleshooting > Generate Diagnostic
Report**. Inspect `managed-config.txt` for policy sources and parse errors.
Dropped bootstrap keys are also recorded in the application log.

### Common failures

| Symptom | Likely cause | Action |
| --- | --- | --- |
| `403 not_entitled` | User has no assigned bootstrap profile | Assign a profile in the console and retry sign-in |
| Repeated sign-in loop | Refresh grant failed, token expired while the app was closed, or device time is wrong | Check `/oauth/token`, session state, Claude Desktop version, and system time |
| Inference `502` | LiteLLM virtual key or `LITELLM_ADMIN_KEY` problem | Check LiteLLM key status, management-key permissions, and Worker logs, then retry |
| Inference `402` | LiteLLM budget exceeded | Raise or reset the user's budget in the LiteLLM UI |
| Settings missing | Profile key failed schema validation or needs consent | Check `managed-config.txt`, the desktop log, and the console's consent-gated key list |

## Upcoming Claude Desktop changes

Plan profile updates against Anthropic's
[configuration changelog](https://claude.com/docs/third-party/claude-desktop/configuration-changelog):

### November 10, 2026

An unset `desktopHome` reads as `standard`. If you set retention periods, set
both `chatSessionRetentionDays` and `coworkSessionRetentionDays` so Chat and
Cowork don't diverge.

### December 17, 2026

Claude Desktop ignores `coworkTabEnabled`, `chatTabEnabled`, and
`chatAdvancedFileAnalysisEnabled`. Use `desktopHome` instead.

Claude Desktop also ignores `sessionRetentionHold`. Before that date, set the
applicable retention periods to 3650 days and wait for devices to receive the
new values if you need to preserve retained sessions.

`organizationPluginsUrl` is already past deprecation and is ignored. Use
`allowedPluginMarketplaces`.

## Official references

- [Bootstrap server](https://claude.com/docs/third-party/claude-desktop/bootstrap)
- [MDM deployment](https://claude.com/docs/third-party/claude-desktop/mdm)
- [Configuration reference](https://claude.com/docs/third-party/claude-desktop/configuration)
- [Configuration changelog](https://claude.com/docs/third-party/claude-desktop/configuration-changelog)
- [Gateway configuration](https://claude.com/docs/third-party/claude-desktop/gateway)
- [Installation](https://claude.com/docs/third-party/claude-desktop/installation)
