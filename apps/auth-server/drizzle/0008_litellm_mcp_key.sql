CREATE TABLE IF NOT EXISTS litellm_user_mcp_key (
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
