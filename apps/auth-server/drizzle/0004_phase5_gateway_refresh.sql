-- Phase 5: LiteLLM gateway + device refresh token rotation
--
-- Two new tables for third-party inference integration:
--   1. litellm_user_key: encrypted API key per user for LiteLLM gateway.
--      Plaintext keys/tokens are NEVER stored; key_ciphertext + key_iv enable
--      server-side decryption only. key_wrap_version tracks key derivation
--      updates if wrapping scheme changes. user_id FK is ON DELETE CASCADE.
--   2. device_refresh_token: family-based refresh token rotation for OAuth
--      device-code flow (RFC 8628). session_id is SET NULL (not CASCADE) so
--      consumed rows survive session deletion — needed for reuse detection.
--      Refresh-token family chains via family_id; replaced_by_id points to the
--      new token in the family. created_at / expires_at are epoch milliseconds.

-- === litellm_user_key ===
CREATE TABLE IF NOT EXISTS litellm_user_key (
  user_id TEXT PRIMARY KEY NOT NULL,
  litellm_user_id TEXT NOT NULL,
  key_alias TEXT NOT NULL,
  token_id TEXT,
  key_ciphertext TEXT NOT NULL,
  key_iv TEXT NOT NULL,
  key_wrap_version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES "user"(id) ON DELETE CASCADE
);

-- === device_refresh_token ===
CREATE TABLE IF NOT EXISTS device_refresh_token (
  id TEXT PRIMARY KEY NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  family_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  session_id TEXT,
  client_id TEXT NOT NULL,
  scope TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER,
  replaced_by_id TEXT,
  FOREIGN KEY (user_id) REFERENCES "user"(id) ON DELETE CASCADE,
  FOREIGN KEY (session_id) REFERENCES "session"(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS device_refresh_token_family_idx ON device_refresh_token(family_id);
CREATE INDEX IF NOT EXISTS device_refresh_token_session_idx ON device_refresh_token(session_id);
CREATE INDEX IF NOT EXISTS device_refresh_token_user_idx ON device_refresh_token(user_id);
CREATE INDEX IF NOT EXISTS device_refresh_token_expires_idx ON device_refresh_token(expires_at);
