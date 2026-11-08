-- Seed well-known OAuth clients that use this auth server.
-- Apply against remote D1 via:
--   wrangler d1 execute evolve-ai-bootstrap-prod --remote --config=wrangler.prod.jsonc --file=scripts/seed-oauth-clients.sql
--
-- Idempotent: uses INSERT OR IGNORE. To reset, DELETE by clientId first.

-- Claude Desktop: public device-code client, consent bypassed (internal tool).
INSERT OR IGNORE INTO "oauthClient" (
  "id",
  "clientId",
  "name",
  "public",
  "skipConsent",
  "disabled",
  "redirectUris",
  "scopes",
  "grantTypes",
  "responseTypes",
  "tokenEndpointAuthMethod",
  "type",
  "is_system",
  "createdAt",
  "updatedAt"
) VALUES (
  'claude-desktop',
  'claude-desktop',
  'Claude Desktop',
  1,
  1,
  0,
  '[]',
  'openid profile email offline_access bootstrap:read',
  'urn:ietf:params:oauth:grant-type:device_code',
  'token',
  'none',
  'public',
  1,
  datetime('now'),
  datetime('now')
);
