import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { decryptByokCredential, encryptByokCredential } from "../src/byok/crypto";
import {
  LEGACY_ODOO_POLICY,
  NATIVE_ODOO_DEFAULT_POLICY,
  NATIVE_ODOO_POLICY,
} from "./_helpers/byok-native";

const DRIZZLE_DIR = fileURLToPath(new URL("../drizzle/", import.meta.url));
const ENCRYPTION_SECRET = "migration-byok-encryption-secret-with-entropy";
const USER_ID = "migration-user-1";
const CONNECTION_ID = "migration-conn-1";
const NATIVE_USER_ID = "migration-native-user-1";
const NATIVE_CONNECTION_ID = "migration-native-conn-1";
const VERSION = 7;
const RAW_CREDENTIAL = "migration-old-odoo-key";

type MigratedFixture = {
  db: DatabaseSync;
  sealed: { ciphertext: string; iv: string };
};

function orderedMigrations(): Array<{ name: string; sql: string }> {
  return readdirSync(DRIZZLE_DIR)
    .filter((name) => /^\d{4}_.+\.sql$/.test(name))
    .sort((left, right) => left.localeCompare(right))
    .map((name) => ({ name, sql: readFileSync(`${DRIZZLE_DIR}/${name}`, "utf8") }));
}

async function migratedFixture(): Promise<MigratedFixture> {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  const sealed = await encryptByokCredential(
    ENCRYPTION_SECRET,
    USER_ID,
    CONNECTION_ID,
    VERSION,
    RAW_CREDENTIAL,
  );
  let seeded = false;

  for (const migration of orderedMigrations()) {
    db.exec(migration.sql);
    if (migration.name.startsWith("0009_")) {
      db.prepare(`INSERT INTO "user" (
        id,name,email,emailVerified,createdAt,updatedAt,role,banned
      ) VALUES (?,?,?,?,?,?,?,?)`).run(
        USER_ID,
        "Migration User",
        "migration-user@example.com",
        1,
        1,
        1,
        "user",
        0,
      );
      db.prepare(`INSERT INTO "user" (
        id,name,email,emailVerified,createdAt,updatedAt,role,banned
      ) VALUES (?,?,?,?,?,?,?,?)`).run(
        "migration-admin-1",
        "Migration Admin",
        "migration-admin@example.com",
        1,
        1,
        1,
        "admin",
        0,
      );
      db.prepare(`INSERT INTO "user" (
        id,name,email,emailVerified,createdAt,updatedAt,role,banned
      ) VALUES (?,?,?,?,?,?,?,?)`).run(
        NATIVE_USER_ID,
        "Native Migration User",
        "migration-native-user@example.com",
        1,
        1,
        1,
        "user",
        0,
      );
      db.prepare(`INSERT INTO byok_connection (
        id,user_id,provider,base_url,database_name,login,credential_ciphertext,credential_iv,
        enabled,version,tested_version,tested_at,test_status,odoo_uid,policy_json,deleted_at,
        mutation_nonce,created_at,updated_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        CONNECTION_ID,
        USER_ID,
        "odoo",
        "https://erp.vortex.so",
        "vortex",
        "migration-user@example.com",
        sealed.ciphertext,
        sealed.iv,
        1,
        VERSION,
        VERSION,
        1_800_000_000_000,
        "ok",
        17,
        JSON.stringify(LEGACY_ODOO_POLICY),
        null,
        "legacy-connection-nonce",
        1,
        2,
      );
      db.prepare(`INSERT INTO byok_connection (
        id,user_id,provider,base_url,database_name,login,credential_ciphertext,credential_iv,
        enabled,version,tested_version,tested_at,test_status,odoo_uid,policy_json,deleted_at,
        mutation_nonce,created_at,updated_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        NATIVE_CONNECTION_ID,
        NATIVE_USER_ID,
        "odoo",
        "https://erp.vortex.so",
        "vortex-native",
        "migration-native-user@example.com",
        "native-ciphertext",
        "native-iv",
        1,
        3,
        3,
        1_800_000_100_000,
        "ok",
        23,
        JSON.stringify(NATIVE_ODOO_POLICY),
        null,
        "native-connection-nonce",
        1,
        2,
      );
      const insertApproval = db.prepare(`INSERT INTO byok_approval (
        id,connection_id,user_id,version,operation,payload_json,before_json,payload_hash,status,
        created_at,expires_at,approved_by,approved_at,result_id,completed_at,mutation_nonce
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
      insertApproval.run(
        "approval-history-1",
        CONNECTION_ID,
        USER_ID,
        VERSION,
        "update",
        JSON.stringify({ taskId: 42, values: { name: "Historical task" } }),
        JSON.stringify({ name: "Before" }),
        "historical-hash",
        "executed",
        10,
        20,
        "migration-admin-1",
        11,
        42,
        12,
        "legacy-approval-nonce",
      );
      for (const status of ["pending", "approved", "executing"] as const) {
        insertApproval.run(
          `approval-${status}-1`,
          CONNECTION_ID,
          USER_ID,
          VERSION,
          "update",
          JSON.stringify({ taskId: 42, values: { name: `${status} task` } }),
          JSON.stringify({ name: "Before" }),
          `${status}-hash`,
          status,
          10,
          20,
          status === "pending" ? null : "migration-admin-1",
          status === "pending" ? null : 11,
          null,
          null,
          `${status}-approval-nonce`,
        );
      }
      insertApproval.run(
        "native-approval-pending-1",
        NATIVE_CONNECTION_ID,
        NATIVE_USER_ID,
        3,
        "update",
        JSON.stringify({ taskId: 84, values: { name: "Native pending task" } }),
        JSON.stringify({ name: "Before" }),
        "native-pending-hash",
        "pending",
        10,
        20,
        null,
        null,
        null,
        null,
        "native-pending-approval-nonce",
      );
      db.prepare(`INSERT INTO byok_runtime_audit (
        id,connection_id,user_id,version,tool,outcome,approval_id,created_at
      ) VALUES (?,?,?,?,?,?,?,?)`).run(
        "runtime-history-1",
        CONNECTION_ID,
        USER_ID,
        VERSION,
        "update_task",
        "success",
        "approval-history-1",
        13,
      );
      seeded = true;
    }
  }

  expect(seeded, "the migration fixture must seed immediately after the available 0009 migration").toBe(true);
  return { db, sealed };
}

describe("native Odoo conservative migration", () => {
  it("rewrites the legacy project policy to native v2 default-deny", async () => {
    const { db } = await migratedFixture();
    try {
      const row = db.prepare("SELECT policy_json FROM byok_connection WHERE id=?").get(CONNECTION_ID) as {
        policy_json: string;
      };
      expect(JSON.parse(row.policy_json)).toEqual(NATIVE_ODOO_DEFAULT_POLICY);
    } finally {
      db.close();
    }
  });

  it("resets stale connection-test state after changing policy semantics", async () => {
    const { db } = await migratedFixture();
    try {
      expect(db.prepare(`SELECT tested_version,tested_at,test_status,odoo_uid
        FROM byok_connection WHERE id=?`).get(CONNECTION_ID)).toEqual({
        tested_version: null,
        tested_at: null,
        test_status: "not_tested",
        odoo_uid: null,
      });
    } finally {
      db.close();
    }
  });

  it("does not bump the SQL version or rewrite the existing encrypted credential", async () => {
    const { db, sealed } = await migratedFixture();
    try {
      const row = db.prepare(`SELECT credential_ciphertext,credential_iv,enabled,version
        FROM byok_connection WHERE id=?`).get(CONNECTION_ID) as {
        credential_ciphertext: string;
        credential_iv: string;
        enabled: number;
        version: number;
      };
      expect(row).toEqual({
        credential_ciphertext: sealed.ciphertext,
        credential_iv: sealed.iv,
        enabled: 1,
        version: VERSION,
      });
      await expect(decryptByokCredential(
        ENCRYPTION_SECRET,
        USER_ID,
        CONNECTION_ID,
        VERSION,
        { ciphertext: row.credential_ciphertext, iv: row.credential_iv },
      )).resolves.toBe(RAW_CREDENTIAL);
    } finally {
      db.close();
    }
  });

  it("preserves retired approval and runtime status history", async () => {
    const { db } = await migratedFixture();
    try {
      expect(db.prepare(`SELECT status,result_id,completed_at FROM byok_approval
        WHERE id='approval-history-1'`).get()).toEqual({
        status: "executed",
        result_id: 42,
        completed_at: 12,
      });
      expect(db.prepare(`SELECT tool,outcome,approval_id FROM byok_runtime_audit
        WHERE id='runtime-history-1'`).get()).toEqual({
        tool: "update_task",
        outcome: "success",
        approval_id: "approval-history-1",
      });
    } finally {
      db.close();
    }
  });

  it("retires only active legacy approvals while preserving completed statuses", async () => {
    const { db } = await migratedFixture();
    try {
      expect(db.prepare(`SELECT id,status FROM byok_approval
        WHERE connection_id=? ORDER BY id`).all(CONNECTION_ID)).toEqual([
        { id: "approval-approved-1", status: "rejected" },
        { id: "approval-executing-1", status: "outcome_unknown" },
        { id: "approval-history-1", status: "executed" },
        { id: "approval-pending-1", status: "rejected" },
      ]);
    } finally {
      db.close();
    }
  });

  it("leaves an already-v2 connection and its approval state unchanged", async () => {
    const { db } = await migratedFixture();
    try {
      const row = db.prepare(`SELECT policy_json,tested_version,tested_at,test_status,odoo_uid,
        credential_ciphertext,credential_iv,enabled,version FROM byok_connection WHERE id=?`
      ).get(NATIVE_CONNECTION_ID) as Record<string, unknown> & { policy_json: string };
      expect({ ...row, policy_json: JSON.parse(row.policy_json) }).toEqual({
        policy_json: NATIVE_ODOO_POLICY,
        tested_version: 3,
        tested_at: 1_800_000_100_000,
        test_status: "ok",
        odoo_uid: 23,
        credential_ciphertext: "native-ciphertext",
        credential_iv: "native-iv",
        enabled: 1,
        version: 3,
      });
      expect(db.prepare("SELECT status FROM byok_approval WHERE id='native-approval-pending-1'").get()).toEqual({
        status: "pending",
      });
    } finally {
      db.close();
    }
  });

  it("does not reset native state when the migration SQL is reapplied", async () => {
    const { db } = await migratedFixture();
    try {
      db.prepare(`UPDATE byok_connection SET policy_json=?,enabled=0,tested_version=version,
        tested_at=?,test_status='ok',odoo_uid=? WHERE id=?`).run(
        JSON.stringify(NATIVE_ODOO_POLICY),
        1_800_000_200_000,
        31,
        CONNECTION_ID,
      );
      db.prepare("UPDATE byok_approval SET status='pending' WHERE id='approval-pending-1'").run();
      const migration = orderedMigrations().find(({ name }) => name.startsWith("0010_"));
      expect(migration, "0010 must be part of the ordered migration set").toBeDefined();
      db.exec(migration!.sql);

      const row = db.prepare(`SELECT policy_json,enabled,version,tested_version,tested_at,test_status,odoo_uid
        FROM byok_connection WHERE id=?`).get(CONNECTION_ID) as Record<string, unknown> & { policy_json: string };
      expect({ ...row, policy_json: JSON.parse(row.policy_json) }).toEqual({
        policy_json: NATIVE_ODOO_POLICY,
        enabled: 0,
        version: VERSION,
        tested_version: VERSION,
        tested_at: 1_800_000_200_000,
        test_status: "ok",
        odoo_uid: 31,
      });
      expect(db.prepare("SELECT status FROM byok_approval WHERE id='approval-pending-1'").get()).toEqual({
        status: "pending",
      });
    } finally {
      db.close();
    }
  });
});
