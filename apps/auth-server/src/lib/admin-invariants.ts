import type { AdminSession } from "./admin-guard";

export class AdminGuardError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
  ) {
    super(code);
  }
}

export function banSelfGuard(session: AdminSession, targetUserId: string): void {
  if (session.user.id === targetUserId) {
    throw new AdminGuardError("cannot_ban_self", 403);
  }
}

export function detectGuardFailure(
  result: D1Result,
  code: string,
  message: string,
): { status: 409; error: string; code: string; message: string } | null {
  if ((result.meta?.changes ?? 0) !== 0) {
    return null;
  }
  return { status: 409, error: code, code, message };
}
