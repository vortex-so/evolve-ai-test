# Vortex internal production rollout

Production uses separate Cloudflare Workers, D1, KV namespaces, secrets, and
custom domains. Development commands and resources remain unchanged.

| Service | Production URL | Worker |
| --- | --- | --- |
| Auth API | `https://api.internal.vortex.so` | `evolve-ai-bootstrap-prod` |
| Auth web | `https://auth.internal.vortex.so` | `vortex-auth-web-prod` |
| Console | `https://console.internal.vortex.so` | `vortex-console-prod` |

## Deploy

Load the existing local Cloudflare credentials in the shell without printing
them. Do not run the development deploy commands for this rollout.

```bash
set -a
. /mnt/work/vortex/evolve-ai-test/.env.local
set +a

pnpm --filter @vortex/auth-server db:migrate:prod
pnpm --filter @vortex/auth-server deploy:prod
pnpm --filter @vortex/auth-web deploy:prod
pnpm --filter @vortex/console deploy:prod
```

The production API config uses the fresh production D1 and the dedicated
`AUTH_KV` and `PLUGINS_KV` namespaces. Provision production secrets with
`wrangler secret put --config apps/auth-server/wrangler.prod.jsonc`; never copy
development secret values. Odoo BYOK is enabled with an isolated production
adapter, `vrt-odoo-mcp-prod`, reachable only through private Flycast. It uses the
reviewed adapter image pinned by digest in `ai-infra/odoo-mcp/fly.prod.toml`; the
development adapter remains unchanged.

The public Odoo gateway stays `https://api.internal.vortex.so/mcp/odoo`.
`ODOO_MCP_ALIAS=odoo_prod` and `ODOO_TEST_MCP_ALIAS=odoo_prod_test` select distinct
LiteLLM routes without changing the signed logical server claims. The normal
route uses the existing `vortex-claude-desktop` MCP access group; the test route
uses the separate `vortex-byok-prod-test` group. The restricted test-service key
allows only that test server and uses `models: ["no-default-models"]`.

Production-only Worker secrets are `BYOK_ENCRYPTION_SECRET`,
`BYOK_ASSERTION_PRIVATE_KEY`, `BYOK_ASSERTION_PUBLIC_KEY`, `BYOK_RUNTIME_TOKEN`,
and `BYOK_TEST_LITELLM_KEY`. Only the public verification key and runtime token
are installed on the adapter. Preserve actual PEM newlines when importing the
public key; verify it parses on the running adapter before testing requests.
Never rotate the encryption secret without a migration for saved credentials.

Each user connection still requires a saved API key, successful connection test,
explicitly enabled access, an Odoo-capable profile, and an allowed-operation
policy. Infrastructure enablement does not create connections or assign profiles.
The production signing/runtime-token path has been checked with a nonexistent
connection: valid assertions reach Worker authorization and return
`403 connection_unavailable`; invalid assertions return `401 invalid_identity`.
Actual Odoo authentication and data operations require a user-supplied connection
and have not been verified by this deployment.

## Verify

```bash
curl -fsS https://api.internal.vortex.so/.well-known/oauth-authorization-server
curl -sSI 'https://api.internal.vortex.so/device?user_code=ABCD-EFGH'
curl -si https://api.internal.vortex.so/user/bootstrap
curl -sSI https://console.internal.vortex.so/dashboard
```

Expected results are production discovery URLs, a device redirect to
`auth.internal.vortex.so`, `401` for bootstrap without a bearer token, and a
console redirect to production sign-in. Do not create a production test user or
run the development Playwright global setup against these hosts.

## First administrator

The production database starts with no users. The intended administrator is
`fakhrulraharjo@gmail.com`, but no account or password is created automatically.
Complete signup and email verification, or request a password reset through the
production auth web UI, then promote the verified account to `admin` through the
console. Do not reuse a development password or mark the email verified by SQL.
