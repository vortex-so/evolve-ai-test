-- Phase 2 plugin tables + column additions
-- Adds: twoFactor plugin, passkey plugin, admin plugin
--
-- HAND-WRITTEN because the `better-auth generate` CLI depends on better-sqlite3
-- native binding which fails to build on Node v137. Regenerate via `db:generate`
-- once the toolchain supports it and diff against this file to confirm parity.
--
-- Column additions to existing tables must be single statements per D1's SQLite.

-- twoFactor plugin: user column
ALTER TABLE "user" ADD COLUMN "twoFactorEnabled" integer DEFAULT 0 NOT NULL;

-- twoFactor plugin: dedicated table
CREATE TABLE "twoFactor" (
  "id" text NOT NULL PRIMARY KEY,
  "secret" text NOT NULL,
  "backupCodes" text NOT NULL,
  "userId" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "verified" integer DEFAULT 1,
  "failedVerificationCount" integer DEFAULT 0,
  "lockedUntil" date
);
CREATE INDEX "twoFactor_secret_idx" ON "twoFactor" ("secret");
CREATE INDEX "twoFactor_userId_idx" ON "twoFactor" ("userId");

-- passkey plugin: dedicated table
CREATE TABLE "passkey" (
  "id" text NOT NULL PRIMARY KEY,
  "name" text,
  "publicKey" text NOT NULL,
  "userId" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "credentialID" text NOT NULL,
  "counter" integer NOT NULL,
  "deviceType" text NOT NULL,
  "backedUp" integer NOT NULL,
  "transports" text,
  "createdAt" date,
  "aaguid" text
);
CREATE INDEX "passkey_userId_idx" ON "passkey" ("userId");
CREATE INDEX "passkey_credentialID_idx" ON "passkey" ("credentialID");

-- admin plugin: user columns
ALTER TABLE "user" ADD COLUMN "role" text;
ALTER TABLE "user" ADD COLUMN "banned" integer DEFAULT 0;
ALTER TABLE "user" ADD COLUMN "banReason" text;
ALTER TABLE "user" ADD COLUMN "banExpires" date;

-- admin plugin: session column for impersonation
ALTER TABLE "session" ADD COLUMN "impersonatedBy" text;
