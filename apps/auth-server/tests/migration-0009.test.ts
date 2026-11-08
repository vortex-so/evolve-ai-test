/// <reference path="./sql.d.ts" />
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import migration from "../drizzle/0009_byok.sql?raw";

function database(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec('CREATE TABLE "user" (id TEXT PRIMARY KEY, email TEXT NOT NULL)');
  db.exec(`CREATE TABLE audit_log (
    id TEXT PRIMARY KEY, created_at INTEGER NOT NULL, request_id TEXT,
    actor_user_id TEXT, actor_email_snapshot TEXT NOT NULL, actor_role_snapshot TEXT NOT NULL,
    acting_as_user_id TEXT, action TEXT NOT NULL, target_type TEXT NOT NULL,
    target_id TEXT, target_snapshot TEXT, outcome TEXT NOT NULL, status_code INTEGER,
    metadata TEXT, ip TEXT, user_agent TEXT
  )`);
  db.exec(migration);
  return db;
}

describe("0009 BYOK migration", () => {
  it("enforces optimistic connection mutation and conditional audit atomically", () => {
    const db = database();
    db.exec("INSERT INTO user (id, email) VALUES ('user-1', 'user@example.com'), ('admin-2', 'admin@example.com')");
    db.exec(`INSERT INTO byok_connection (
      id,user_id,provider,base_url,database_name,login,credential_ciphertext,credential_iv,
      enabled,version,test_status,policy_json,mutation_nonce,created_at,updated_at
    ) VALUES ('conn-1','user-1','odoo','https://erp.vortex.so','db','login','cipher','iv',0,1,'not_tested','{}','old',1,1)`);

    db.exec("BEGIN IMMEDIATE");
    const update = db.prepare("UPDATE byok_connection SET version=2, mutation_nonce='nonce-2' WHERE id='conn-1' AND version=1").run();
    db.prepare(`INSERT INTO audit_log (
      id,created_at,actor_email_snapshot,actor_role_snapshot,action,target_type,target_id,outcome,status_code
    ) SELECT 'audit-1',2,'admin@example.com','admin','admin.byok.update','byok_connection',id,'success',200
      FROM byok_connection WHERE id='conn-1' AND mutation_nonce='nonce-2'`).run();
    db.exec("COMMIT");
    expect(update.changes).toBe(1);
    expect(db.prepare("SELECT count(*) AS count FROM audit_log").get()).toEqual({ count: 1 });

    db.exec("BEGIN IMMEDIATE");
    const stale = db.prepare("UPDATE byok_connection SET version=3, mutation_nonce='stale' WHERE id='conn-1' AND version=1").run();
    db.prepare(`INSERT INTO audit_log (
      id,created_at,actor_email_snapshot,actor_role_snapshot,action,target_type,target_id,outcome,status_code
    ) SELECT 'audit-stale',3,'admin@example.com','admin','admin.byok.update','byok_connection',id,'success',200
      FROM byok_connection WHERE id='conn-1' AND mutation_nonce='stale'`).run();
    db.exec("COMMIT");
    expect(stale.changes).toBe(0);
    expect(db.prepare("SELECT count(*) AS count FROM audit_log").get()).toEqual({ count: 1 });
    db.close();
  });

  it("allows an approved write to be claimed exactly once", () => {
    const db = database();
    db.exec("INSERT INTO user (id, email) VALUES ('user-1', 'user@example.com'), ('admin-2', 'admin@example.com')");
    db.exec(`INSERT INTO byok_connection (
      id,user_id,provider,base_url,database_name,login,credential_ciphertext,credential_iv,
      enabled,version,tested_version,test_status,policy_json,mutation_nonce,created_at,updated_at
    ) VALUES ('conn-1','user-1','odoo','https://erp.vortex.so','db','login','cipher','iv',1,2,2,'ok','{}','n',1,1)`);
    db.exec(`INSERT INTO byok_approval (
      id,connection_id,user_id,version,operation,payload_json,before_json,payload_hash,status,
      created_at,expires_at,approved_by,approved_at,mutation_nonce
    ) VALUES ('approval-1','conn-1','user-1',2,'create','{}',NULL,'hash','pending',1,9999999999999,NULL,NULL,'a')`);

    const selfApproval = db.prepare(`UPDATE byok_approval SET status='approved', approved_by='user-1', approved_at=2
      WHERE id='approval-1' AND status='pending' AND expires_at>100 AND user_id<>'user-1'
      AND EXISTS (SELECT 1 FROM byok_connection c WHERE c.id=connection_id AND c.version=byok_approval.version)`).run();
    const approval = db.prepare(`UPDATE byok_approval SET status='approved', approved_by='admin-2', approved_at=2
      WHERE id='approval-1' AND status='pending' AND expires_at>100 AND user_id<>'admin-2'
      AND EXISTS (SELECT 1 FROM byok_connection c WHERE c.id=connection_id AND c.version=byok_approval.version)`).run();
    const repeatedApproval = db.prepare("UPDATE byok_approval SET approved_at=3 WHERE id='approval-1' AND status='pending'").run();
    expect(selfApproval.changes).toBe(0);
    expect(approval.changes).toBe(1);
    expect(repeatedApproval.changes).toBe(0);

    const wrongUser = db.prepare(`UPDATE byok_approval SET status='executing'
      WHERE id='approval-1' AND user_id='user-2' AND version=2 AND status='approved'`).run();
    const wrongVersion = db.prepare(`UPDATE byok_approval SET status='executing'
      WHERE id='approval-1' AND user_id='user-1' AND version=1 AND status='approved'`).run();
    expect(wrongUser.changes).toBe(0);
    expect(wrongVersion.changes).toBe(0);

    const claim = db.prepare(`UPDATE byok_approval SET status='executing', mutation_nonce='claim'
      WHERE id='approval-1' AND user_id='user-1' AND version=2 AND status='approved'
      AND expires_at>100 AND EXISTS (
        SELECT 1 FROM byok_connection c WHERE c.id=connection_id AND c.user_id='user-1'
        AND c.version=2 AND c.enabled=1 AND c.tested_version=c.version AND c.test_status='ok'
      )`).run();
    const replay = db.prepare("UPDATE byok_approval SET mutation_nonce='replay' WHERE id='approval-1' AND status='approved'").run();

    expect(claim.changes).toBe(1);
    expect(replay.changes).toBe(0);
    expect(db.prepare("SELECT status FROM byok_approval WHERE id='approval-1'").get()).toEqual({ status: "executing" });
    db.close();
  });
});
