# @vortex/sso-monorepo

pnpm + Turborepo monorepo for the Vortex company internal SSO stack, built on
Better Auth on Cloudflare Workers + D1. Current dev deployment lives at
`https://api.auth-dev.vortex.so`.

## Layout

```
apps/
  auth-server/     Cloudflare Worker + Better Auth API (Phase 1 — live)
  auth-web/        Next.js user-facing auth pages (Phase 3 — planned)
  console/         Next.js admin dashboard (Phase 4 — planned)
packages/
  schema/          Shared TypeScript types across apps
  config/          Shared eslint / tsconfig / prettier (Phase 2+)
```

## Commands (from repo root)

```
pnpm install
pnpm turbo run typecheck                            # all packages
pnpm --filter @vortex/auth-server run dev           # wrangler dev
pnpm --filter @vortex/auth-server run deploy        # ship auth-server
pnpm --filter @vortex/auth-server run db:generate   # regen migration SQL
pnpm --filter @vortex/auth-server run db:migrate:remote
```

## Auth server — current state

Cloudflare Workers implementation of the [Claude Desktop on 3P bootstrap
server](https://claude.com/docs/third-party/claude-desktop/bootstrap) protocol,
built on Better Auth in **device-code mode**.

## What this is

Claude Desktop on 3P fetches per-user configuration from an HTTPS endpoint at
launch. In device-code mode, one server acts as **both** the OAuth authorization
server (issues bearer tokens via RFC 8628 device-code grant) and the config
server (returns JSON matching `bootstrap-config-v2`). Same origin, one sign-in,
inference credentials can be scoped per user.

```
Claude Desktop                        this Worker (evolve-ai bootstrap)
─────────────                         ──────────────────────────────────
launch
  │
  │ GET /.well-known/oauth-authorization-server ──▶ buildDiscoveryMetadata()
  │
  │ POST /oauth/device (RFC 8628) ────────────────▶ Better Auth deviceAuthorization
  │◀── {device_code, user_code, verification_uri}
  │
  │ open verification_uri in browser
  │       user signs in via Better Auth (/sign-in)
  │
  │ POST /oauth/token (poll) ─────────────────────▶ Better Auth token endpoint
  │◀── {access_token}                              (issued as JWT via jwt plugin)
  │
  │ GET /user/bootstrap   Authorization: Bearer …▶ bootstrapHandler
  │                                                 │ verify JWT via /api/auth/jwks
  │                                                 │ resolveUserRoles(sub)
  │◀── 200 application/json   {inferenceProvider…} └ selectProfile() → JSON
```

## Prerequisites

- Node 20+
- `wrangler` logged in to your Cloudflare account
- Claude Desktop 1.10628.0+ on a test machine

## First-time setup

```bash
npm install

# 1. Create the D1 database and copy its ID into wrangler.toml
wrangler d1 create evolve-ai-bootstrap
# → paste database_id into wrangler.toml under [[d1_databases]]

# 2. Generate Better Auth's schema, then create a Wrangler migration from it
npm run db:generate
wrangler d1 migrations create evolve-ai-bootstrap init
# move drizzle/schema.sql to the timestamped file Wrangler just created,
# e.g. drizzle/migrations/<timestamp>_init.sql
npm run db:migrate:local     # for `wrangler dev`
npm run db:migrate:remote    # for production

# 3. Set the signing secret
wrangler secret put BETTER_AUTH_SECRET   # paste 32+ random bytes

# 4. Point wrangler.toml [vars] PUBLIC_ORIGIN at your worker's real URL

# 5. Ship
npm run deploy
```

## Verify from the outside

```bash
# discovery must return JSON with device_authorization_endpoint + token_endpoint
curl -s https://YOUR-WORKER.workers.dev/.well-known/oauth-authorization-server | jq

# device grant returns a user_code and verification_uri on your origin
curl -s -X POST https://YOUR-WORKER.workers.dev/oauth/device \
  -H 'content-type: application/x-www-form-urlencoded' \
  --data 'client_id=claude-desktop&scope=openid+offline_access+bootstrap:read'

# after approving in the browser, exchange the device_code for a bearer
curl -s -X POST https://YOUR-WORKER.workers.dev/oauth/token \
  -H 'content-type: application/x-www-form-urlencoded' \
  --data 'grant_type=urn:ietf:params:oauth:grant-type:device_code' \
  --data 'device_code=…' \
  --data 'client_id=claude-desktop'

# bootstrap responds with your JSON config
curl -si https://YOUR-WORKER.workers.dev/user/bootstrap \
  -H "authorization: Bearer $ACCESS_TOKEN"
# Look for: Cache-Control: no-store, application/json body, no 3xx
```

## Point Claude Desktop at it

In the **Configure Third-Party Inference → Source** window (device-code mode,
so the OIDC panel stays empty):

| Field                | Value                                         |
| -------------------- | --------------------------------------------- |
| Use bootstrap config | on                                            |
| Bootstrap config URL | `https://YOUR-WORKER.workers.dev/user/bootstrap` |
| Bootstrap OIDC       | leave every field empty                       |

Click **Apply Changes** and quit/relaunch Claude Desktop. Sign in via the device
code that the app displays. On success the sign-in screen offers the third-party
option and reads its config from the response above.

For fleet deployment, export the resulting profile from the same window (`.mobileconfig` for macOS, `.reg` for Windows) and push it through your MDM.

## What to change per environment

- **`INFERENCE_GATEWAY_BASE_URL`** in `wrangler.toml` — in device-code mode this
  must share `PUBLIC_ORIGIN` (origin-pinning). Front a real gateway (LiteLLM,
  your own) on the same worker route, or switch to PKCE mode (populate the OIDC
  panel and drop origin-pinning).
- **`src/bootstrap/profiles.ts` → `resolveUserRoles`** — wire this to your
  actual entitlement source. Today it returns `["cowork-user"]` for everyone.
- **`src/bootstrap/profiles.ts` → `selectProfile`** — model lists, egress
  allowlist, MCP servers, OTel attributes go here.
- **`src/auth.ts` → `emailAndPassword`** — swap for social providers or the
  SSO plugin if you don't want Better Auth to own the user directory.

## Gotchas

- **Response must be a JSON object.** An HTML page from a captive portal or a
  JSON array causes Claude Desktop to fail with a parse error. Never proxy
  `/user/bootstrap` through anything that might rewrite the body.
- **No 3xx from `/user/bootstrap`.** Claude Desktop treats redirects as errors
  by design (prevents same-origin open-redirect bearer exfiltration).
- **`Cache-Control: no-store` is not optional.** A reverse proxy caching a
  bearer'd response and serving it to the next user is a full account takeover.
- **Origin pinning in device-code mode.** `inferenceGatewayBaseUrl`,
  `inferenceVertexBaseUrl`, `inferenceBedrockBaseUrl`, `organizationPluginsUrl`
  must share the bootstrap origin or Claude Desktop drops them silently. Check
  `~/Library/Logs/Claude-3p/main.log` when in doubt.
- **Loopback hosts are stripped.** `127.0.0.1`, `localhost`, `[::1]` in any
  URL-valued key are dropped from the response.
- **Bootstrap key list is validated.** Unknown keys and keys that fail schema
  validation are dropped silently; one bad key never invalidates the rest, but
  a whole missing profile silently degrades the client.

## Files

```
src/
├── auth.ts                       Better Auth: oauth-provider + deviceAuthorization + jwt
├── index.ts                      Hono app: RFC paths, /user/bootstrap, /api/auth/*
└── bootstrap/
    ├── discovery.ts              buildDiscoveryMetadata(origin)
    ├── endpoint.ts               bootstrapHandler — verifies JWT, returns config
    └── profiles.ts               selectProfile + resolveUserRoles (edit this)
```
