CREATE TABLE IF NOT EXISTS byok_connection (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL UNIQUE,
  provider TEXT NOT NULL CHECK (provider = 'odoo'),
  base_url TEXT NOT NULL CHECK (base_url = 'https://erp.vortex.so'),
  database_name TEXT NOT NULL,
  login TEXT NOT NULL,
  credential_ciphertext TEXT,
  credential_iv TEXT,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  version INTEGER NOT NULL,
  tested_version INTEGER,
  tested_at INTEGER,
  test_status TEXT NOT NULL DEFAULT 'not_tested' CHECK (test_status IN ('not_tested', 'ok', 'failed')),
  odoo_uid INTEGER,
  policy_json TEXT NOT NULL,
  deleted_at INTEGER,
  mutation_nonce TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES "user"(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS byok_connection_user_version_idx
  ON byok_connection(user_id, version);

CREATE TABLE IF NOT EXISTS byok_approval (
  id TEXT PRIMARY KEY NOT NULL,
  connection_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  operation TEXT NOT NULL CHECK (operation IN ('create', 'update')),
  payload_json TEXT NOT NULL,
  before_json TEXT,
  payload_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'executing', 'executed', 'outcome_unknown', 'failed')),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  approved_by TEXT,
  approved_at INTEGER,
  result_id INTEGER,
  completed_at INTEGER,
  mutation_nonce TEXT NOT NULL,
  FOREIGN KEY (connection_id) REFERENCES byok_connection(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES "user"(id) ON DELETE CASCADE,
  FOREIGN KEY (approved_by) REFERENCES "user"(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS byok_approval_user_status_created_idx
  ON byok_approval(user_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS byok_approval_status_expires_idx
  ON byok_approval(status, expires_at);

CREATE TABLE IF NOT EXISTS byok_runtime_audit (
  id TEXT PRIMARY KEY NOT NULL,
  connection_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  tool TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('started', 'success', 'failure', 'denied')),
  approval_id TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (connection_id) REFERENCES byok_connection(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES "user"(id) ON DELETE CASCADE,
  FOREIGN KEY (approval_id) REFERENCES byok_approval(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS byok_runtime_audit_connection_created_idx
  ON byok_runtime_audit(connection_id, created_at DESC);
