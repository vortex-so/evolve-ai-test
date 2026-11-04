-- Phase 4: Admin Console — audit log + bootstrap profiles (D1-driven)
--
-- Revised per oracle architectural review (bg_a53fbd23):
--   1. audit_log: added request_id, outcome/status_code, actor snapshot
--      (email + role at time of action), acting_as_user_id for impersonation
--      context, target_snapshot; FKs are ON DELETE SET NULL so audit survives
--      user/profile deletion; cursor index on (created_at DESC, id).
--   2. bootstrap: dropped many-to-many bootstrap_role_assignment; replaced with
--      bootstrap_user_profile(user_id UNIQUE, profile_id) — single profile per
--      user, deterministic. Kept bootstrap_profile.config as JSON with
--      schema_version for future migrations. Server-side Zod validation on
--      writes lives in auth-server.
--   3. deviceCode: 0001 schema shipped WITHOUT createdAt — needed for audit
--      + admin device inspector. Adding as NULL for existing rows.

-- === audit_log ===
CREATE TABLE audit_log (
  id TEXT PRIMARY KEY NOT NULL,
  created_at INTEGER NOT NULL,
  request_id TEXT,
  actor_user_id TEXT,
  actor_email_snapshot TEXT NOT NULL,
  actor_role_snapshot TEXT NOT NULL,
  acting_as_user_id TEXT,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT,
  target_snapshot TEXT,
  outcome TEXT NOT NULL,
  status_code INTEGER,
  metadata TEXT,
  ip TEXT,
  user_agent TEXT,
  FOREIGN KEY (actor_user_id) REFERENCES user(id) ON DELETE SET NULL,
  FOREIGN KEY (acting_as_user_id) REFERENCES user(id) ON DELETE SET NULL
);
CREATE INDEX audit_log_cursor_idx ON audit_log(created_at DESC, id);
CREATE INDEX audit_log_actor_idx ON audit_log(actor_user_id, created_at DESC);
CREATE INDEX audit_log_target_idx ON audit_log(target_type, target_id, created_at DESC);
CREATE INDEX audit_log_action_idx ON audit_log(action, created_at DESC);
CREATE INDEX audit_log_outcome_idx ON audit_log(outcome, created_at DESC);

-- === bootstrap_profile ===
CREATE TABLE bootstrap_profile (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  config TEXT NOT NULL,
  schema_version INTEGER NOT NULL DEFAULT 1,
  is_default INTEGER NOT NULL DEFAULT 0,
  is_system INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX bootstrap_profile_default_idx ON bootstrap_profile(is_default) WHERE is_default = 1;

-- === bootstrap_user_profile ===
-- One profile per user. Assignment is deterministic (no merge). Users with no
-- assignment get the profile row where is_default = 1.
CREATE TABLE bootstrap_user_profile (
  user_id TEXT PRIMARY KEY NOT NULL,
  profile_id TEXT NOT NULL,
  assigned_by_user_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE,
  FOREIGN KEY (profile_id) REFERENCES bootstrap_profile(id) ON DELETE RESTRICT,
  FOREIGN KEY (assigned_by_user_id) REFERENCES user(id) ON DELETE SET NULL
);
CREATE INDEX bootstrap_user_profile_profile_idx ON bootstrap_user_profile(profile_id);

-- === deviceCode.createdAt ===
-- Missing from 0001 schema — needed for audit correlation + admin device inspector
-- cursor pagination. Nullable for existing rows.
ALTER TABLE deviceCode ADD COLUMN createdAt INTEGER;
CREATE INDEX deviceCode_created_idx ON deviceCode(createdAt DESC, id);
CREATE INDEX deviceCode_status_created_idx ON deviceCode(status, createdAt DESC);
CREATE INDEX deviceCode_user_created_idx ON deviceCode(userId, createdAt DESC);

-- === oauthClient.is_system ===
-- Dedicated column (not metadata JSON) so protected-client guard is a hard
-- SQL predicate — `DELETE ... WHERE is_system = 0` is atomic and cannot be
-- clobbered by an accidental UPDATE that overwrites metadata.
-- Backfill: claude-desktop is the system client for Claude Desktop bootstrap.
ALTER TABLE oauthClient ADD COLUMN is_system INTEGER NOT NULL DEFAULT 0;
UPDATE oauthClient SET is_system = 1 WHERE clientId = 'claude-desktop';
CREATE INDEX oauthClient_system_idx ON oauthClient(is_system);

-- === Seed default bootstrap profile ===
-- config is empty here — server-side loader falls through to hardcoded default
-- in profiles.ts until an admin edits this row. Marked is_system so console
-- cannot delete it (only edit).
INSERT INTO bootstrap_profile (
  id, name, description, config, schema_version, is_default, is_system, created_at, updated_at
) VALUES (
  'default-cowork-user',
  'cowork-user',
  'Default Claude Desktop bootstrap profile — edit config to override the hardcoded fallback',
  '{}',
  1,
  1,
  1,
  strftime('%s','now') * 1000,
  strftime('%s','now') * 1000
);
