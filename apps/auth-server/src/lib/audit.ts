import type { Env } from "../auth";
import type { AuditContext } from "./admin-guard";

export type AuditWriteInput = {
  action: string;
  target_type: string;
  target_id?: string | null;
  target_snapshot?: unknown;
  outcome: "success" | "failure";
  status_code: number;
  metadata?: unknown;
};

function stringifyOrNull(value: unknown): string | null {
  if (value === undefined) return null;
  return JSON.stringify(value);
}

export function logAuditWriteFailure(error: unknown, input: AuditWriteInput): void {
  console.error({
    audit_write_failed: true,
    error: String(error),
    action: input.action,
    target_type: input.target_type,
    target_id: input.target_id ?? null,
    outcome: input.outcome,
    status_code: input.status_code,
  });
}

export async function writeAudit(
  env: Env,
  ctx: AuditContext | null | undefined,
  input: AuditWriteInput,
): Promise<void> {
  if (!ctx) {
    return;
  }

  await env.DB.prepare(
    `INSERT INTO audit_log (
      id,
      created_at,
      request_id,
      actor_user_id,
      actor_email_snapshot,
      actor_role_snapshot,
      acting_as_user_id,
      action,
      target_type,
      target_id,
      target_snapshot,
      outcome,
      status_code,
      metadata,
      ip,
      user_agent
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      crypto.randomUUID(),
      Date.now(),
      ctx.request_id,
      ctx.actor_user_id,
      ctx.actor_email_snapshot,
      ctx.actor_role_snapshot,
      ctx.acting_as_user_id,
      input.action,
      input.target_type,
      input.target_id ?? null,
      stringifyOrNull(input.target_snapshot),
      input.outcome,
      input.status_code,
      stringifyOrNull(input.metadata),
      ctx.ip,
      ctx.user_agent,
    )
    .run();
}
