<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

Key Next.js 16 changes relevant to this app:
- `cookies()` and `headers()` are **async** — always `await` them
- `params` and `searchParams` are **Promises** in page/layout props
- Route handlers use standard Web `Request`/`Response`
- This app is **dynamic** (no `output: "export"`). All admin pages require SSR for session guard.
- Deploy via `@opennextjs/cloudflare` — `pnpm run deploy`
<!-- END:nextjs-agent-rules -->

# Security boundary — console admin trust model

Phase 4 admin surface has ONE trust boundary. Violating it is a fatal defect.

## Rule 1 — BFF only, no direct browser → auth-server admin calls
- Browser code in `apps/console/**` MUST NOT call `https://api.auth-dev.vortex.so/api/auth/admin/*` or `/admin/*` directly.
- `apps/console/src/lib/auth-client.ts` intentionally omits `adminClient()`. Do not add it back.
- All admin actions go through `apps/console/src/app/api/admin/**` Route Handlers, which:
  1. Read cookies with `await cookies()`
  2. Fetch session from auth-server and verify `session.user.role === "admin"` AND `!session.impersonatedBy`
  3. Verify `Origin` header exactly matches `https://console.auth-dev.vortex.so`
  4. Forward to auth-server admin endpoint server-to-server WITH the session cookie

## Rule 2 — impersonated sessions cannot mutate
- Every `/api/admin/**` mutation checks `session.impersonatedBy` and returns 403 if set.
- Auth-server also enforces this in `/admin/*` middleware and inside Better Auth mutation hooks.
- Two-layer defense — do NOT rely on the console-side check alone.

## Rule 3 — protected system OAuth clients
- `oauthClient.is_system = 1` marks system clients (Claude Desktop bootstrap etc).
- `DELETE FROM oauthClient WHERE id = ? AND is_system = 0` is the atomic guard.
- Console MUST NOT ship a delete UI that bypasses the guard.

## Rule 4 — last-admin protection (target-aware atomic SQL)

The guard must fire **only when the target action would remove the last admin** — not when unrelated users are deleted or promoted while the admin count is low.

**setRole (target-aware, all paths):**
```sql
UPDATE user SET role = :newRole WHERE id = :targetId
  AND (
    role != 'admin'
    OR :newRole = 'admin'
    OR (SELECT COUNT(*) FROM user WHERE role = 'admin' AND id != :targetId) > 0
  );
```
Semantics (evaluated in order):
- current role is NOT admin → allow (no admin loss possible)
- new role IS admin → allow (promotion or re-affirming admin)
- otherwise (demoting an admin) → allow only if another admin exists

**removeUser:**
```sql
DELETE FROM user WHERE id = :targetId
  AND (
    role != 'admin'
    OR (SELECT COUNT(*) FROM user WHERE role = 'admin' AND id != :targetId) > 0
  );
```
Semantics: deleting a non-admin always allowed; deleting an admin allowed only if another admin exists.

**Ban-user (soft demote):** Better Auth's `banUser` does not change `role`, but a banned admin cannot sign in — same last-admin risk. Guard equivalently:
```sql
UPDATE user SET banned = 1, banReason = :reason, banExpires = :expires
  WHERE id = :targetId
    AND (
      role != 'admin'
      OR (SELECT COUNT(*) FROM user WHERE role = 'admin' AND banned = 0 AND id != :targetId) > 0
    );
```

**Guard failure signal:** each mutation checks `result.meta.changes === 0` → 409 CONFLICT with `last_admin_protected`.

**Ban-self:** reject when `targetId === session.user.id` BEFORE the mutation (also cheap defense-in-depth).

**Concurrency correctness (single-writer + snapshot isolation):**
D1 routes every write to a single active copy of the database (a Durable Object) with snapshot isolation, so concurrent HTTP requests targeting the same DB are serialized at the primary. Two admins each attempting to demote a different last-admin candidate cannot both pass their respective guards:
- Request A's UPDATE runs to completion, `admin` count drops from 2 to 1.
- Request B's UPDATE runs next, its subquery `(SELECT COUNT(*) FROM user WHERE role='admin' AND id != :B)` now returns 0, guard fails, `changes=0`, 409 returned.

Source: [Cloudflare D1 — "Building D1: a Global Database"](https://blog.cloudflare.com/building-d1-a-global-database) — "D1 provides snapshot isolation by default, which is implemented by routing all HTTP requests to a single active copy of the database."

For multi-statement admin flows (rare — e.g. transfer-admin-then-demote), wrap in `env.DB.transaction(async (tx) => { ... })` so the sequence is atomic end-to-end.

## Rule 5 — bootstrap profile writes
- All writes go through `validateBootstrapConfig` (Zod schema mirroring `BootstrapConfig`).
- Invalid config → 400, no D1 write, audit row `outcome=failure`.
- `bootstrap_profile.is_system = 1` rows cannot be deleted (only edited).

## Rule 6 — audit log is synchronous
- Every admin mutation writes an `audit_log` row BEFORE returning to the client.
- NOT via `hooks.after + ctx.waitUntil`. Best-effort audit was rejected in review.
- `audit_log` FKs are `ON DELETE SET NULL` — audit survives target user/profile deletion.
