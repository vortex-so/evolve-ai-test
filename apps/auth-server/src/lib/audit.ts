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

const REDACTED_VALUE = "[REDACTED]";
const SENSITIVE_KEY_PATTERN = /pass(word)?|secret|token|api[_-]?key|authorization|otp|code_verifier|private[_-]?key|client[_-]?secret/i;
const AUDIT_KEY_ALLOWLIST = new Set(["token_endpoint"]);

function redactAuditValueRecursive(
  value: unknown,
  seen: WeakSet<object>,
): unknown {
  if (value === null || typeof value !== "object") {
    return value;
  }

  if (seen.has(value)) {
    return REDACTED_VALUE;
  }

  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((item) => redactAuditValueRecursive(item, seen));
    }

    const redacted: Record<string, unknown> = {};
    for (const [key, nestedValue] of Object.entries(value)) {
      redacted[key] =
        !AUDIT_KEY_ALLOWLIST.has(key) && SENSITIVE_KEY_PATTERN.test(key)
          ? REDACTED_VALUE
          : redactAuditValueRecursive(nestedValue, seen);
    }
    return redacted;
  } finally {
    seen.delete(value);
  }
}

export function redactAuditValue(value: unknown): unknown {
  try {
    return redactAuditValueRecursive(value, new WeakSet());
  } catch (error) {
    console.error("Audit value redaction failed", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return value !== null && typeof value === "object" ? REDACTED_VALUE : value;
  }
}

function stringifyOrNull(value: unknown): string | null {
  if (value === undefined) return null;
  return JSON.stringify(redactAuditValue(value));
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
