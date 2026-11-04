# @vortex/sso-monorepo

pnpm and Turborepo monorepo for Vortex authentication, Claude Desktop
third-party bootstrap, and per-user inference access. All implementation phases
are complete in the current development environment.

| Service | URL | Purpose |
| --- | --- | --- |
| Auth API | `https://api.auth-dev.vortex.so` | OAuth device flow, Better Auth, bootstrap config, inference gateway, and admin API |
| Auth web | `https://auth.auth-dev.vortex.so` | Sign-in, consent, device approval, and account settings |
| Console | `https://console.auth-dev.vortex.so` | Administrative dashboard and bootstrap profile management |

For deployment, device policy, verification, and troubleshooting, see
[`docs/claude-desktop-3p-deployment.md`](docs/claude-desktop-3p-deployment.md).

## Repository layout

```text
apps/
  auth-server/  Cloudflare Worker using Hono, Better Auth 1.6, D1, and KV
  auth-web/     Next.js 16 user UI, exported for Cloudflare deployment
  console/      Next.js 16 admin dashboard deployed with OpenNext for Cloudflare
packages/
  schema/       Shared BootstrapConfig type, official v1 schema, and validator
  ui/           Shared shadcn-style UI and auth components
  config/       Placeholder for future shared tooling configuration
```

The console covers users, sessions, devices, OAuth clients, bootstrap profiles
and assignments, and the audit log. Browser requests use console BFF routes;
the BFF calls the auth server's protected admin API.

## Auth server endpoints

`apps/auth-server/src/index.tsx` exposes:

| Endpoint | Purpose |
| --- | --- |
| `/.well-known/oauth-authorization-server` | OAuth authorization server discovery |
| `/oauth/device` | RFC 8628 device authorization |
| `/oauth/token` | Device-code and refresh-token grants |
| `/device` | Redirect to the auth-web device approval page |
| `/user/bootstrap` | Entitled user's Claude Desktop bootstrap config |
| `/v1/messages` | LiteLLM-backed inference, streaming or non-streaming |
| `/v1/messages/count_tokens` | Token counting through LiteLLM |
| `/v1/models` | Model discovery through LiteLLM |
| `/api/auth/*` | Better Auth API |
| `/admin/*` | Admin API used by the console BFF |

Inference uses server-managed, per-user LiteLLM virtual keys. LiteLLM
credentials are never returned to Claude Desktop.

## Access and bootstrap profiles

An authenticated user is entitled only when an administrator has assigned a
bootstrap profile, or when the user has the `admin` role. Administrators receive
the default profile. Other users receive `403` from bootstrap and inference
routes, and can't refresh their device-flow session.

Profiles use the flat v1 format and should include `$schemaVersion: 1`. Profile
writes are validated against the vendored official schema at
`packages/schema/schemas/bootstrap-config-v1.schema.json`. The server injects
`inferenceGatewayBaseUrl` and `expiresAt` into the served config.

Refresh the vendored schema with:

```bash
pnpm --filter @vortex/schema update-schema
```

## Common commands

Run from the repository root:

```bash
pnpm install
pnpm turbo run typecheck

pnpm --filter @vortex/auth-server test
pnpm --filter @vortex/auth-server dev
pnpm --filter @vortex/auth-server db:migrate:remote
pnpm --filter @vortex/auth-server deploy

pnpm --filter @vortex/console test
pnpm --filter @vortex/console test:e2e
pnpm --filter @vortex/console deploy

pnpm --filter @vortex/schema test
```

Remote D1 migrations are checked in at `apps/auth-server/drizzle/0001` through
`0005`. Apply them before deploying code that depends on them.

## Worker configuration

Non-secret values live in `apps/auth-server/wrangler.jsonc`:

- `PUBLIC_ORIGIN`
- `INFERENCE_GATEWAY_BASE_URL`, the API origin without `/v1`
- `LITELLM_BASE_URL`
- `AUTH_WEB_ORIGIN`
- `PRODUCT_NAME` and `PRODUCT_URL`

Worker secrets:

- `BETTER_AUTH_SECRET` (non-empty, 32+ random characters)
- `LITELLM_KEY_ENCRYPTION_SECRET`, encrypts stored per-user LiteLLM keys
- `LITELLM_ADMIN_KEY`, a LiteLLM proxy-admin key
- `POSTMARK_SERVER_TOKEN` and `POSTMARK_FROM`

The Worker also requires the configured D1 `DB` and KV `AUTH_KV` bindings.

## End-to-end tests

The console Playwright suite runs against the live development services. The
full suite needs `PLAYWRIGHT_CF_TOKEN` for D1 mutation setup and
`PLAYWRIGHT_POSTMARK_TOKEN` for delivery checks. Origin overrides are available
for alternate environments. `PLAYWRIGHT_HOST_RESOLVER_RULES` is optional for
networks that can't reach one Cloudflare edge IP; see
`apps/console/playwright.config.ts`.

## Point Claude Desktop at it

Use device-code mode and set only:

```json
{
  "bootstrapUrl": "https://api.auth-dev.vortex.so/user/bootstrap"
}
```

Don't configure `bootstrapOidc`. Ready-to-deploy macOS, Windows, Linux, and
import templates are in [`docs/templates/`](docs/templates/).

## Gotchas

- The bootstrap response must be a JSON object. HTML or an array causes a parse
  failure.
- `/user/bootstrap` must not redirect. Claude Desktop rejects redirects; the
  endpoint may return `304` only for an unchanged ETag.
- `Cache-Control: no-store` is required because the response is user-specific.
- Device-code mode pins URL-valued inference settings to the bootstrap origin,
  including `inferenceGatewayBaseUrl`, `inferenceVertexBaseUrl`,
  `inferenceBedrockBaseUrl`, and `inferenceFoundryBaseUrl`.
- Claude Desktop strips loopback hosts such as `127.0.0.1`, `localhost`, and
  `[::1]` from URL-valued keys.
- Profile writes reject unknown or schema-invalid keys. Claude Desktop can also
  drop unknown keys silently, so check its logs when a setting is missing.
- Keys omitted from the selected bootstrap profile are unset on the device.
- `organizationPluginsUrl` is deprecated and ignored. Use
  `allowedPluginMarketplaces`.
