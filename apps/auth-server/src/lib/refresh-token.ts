export const REFRESH_TOKEN_TTL_SECONDS = 604_800;

export type SessionPort = {
  createSession(userId: string): Promise<{ id: string; token: string; expiresAt: Date }>;
  deleteSession(token: string): Promise<void>;
};

export type RefreshGrantBody = {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  refresh_token: string;
  refresh_token_expires_in: number;
  scope?: string;
};

export type RefreshResult =
  | { ok: true; body: RefreshGrantBody }
  | { ok: false; error: "invalid_grant" | "invalid_request" };

type RefreshTokenRow = {
  id: string;
  token_hash: string;
  family_id: string;
  user_id: string;
  session_id: string | null;
  client_id: string;
  scope: string | null;
  created_at: number;
  expires_at: number;
  consumed_at: number | null;
  replaced_by_id: string | null;
};

type SessionIdentityRow = {
  id: string;
  userId: string;
};

type SessionTokenRow = {
  token: string;
};

type FamilySessionRow = {
  session_id: string | null;
};

function defaultRandomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function createRefreshTokenService(deps: {
  db: D1Database;
  sessions: SessionPort;
  isEntitled(userId: string): Promise<boolean>;
  now?: () => number;
  randomToken?: () => string;
}) {
  const now = deps.now ?? Date.now;
  const randomToken = deps.randomToken ?? defaultRandomToken;

  async function insertRefreshToken(input: {
    familyId: string;
    userId: string;
    sessionId: string;
    clientId: string;
    scope: string | null;
    createdAt: number;
  }) {
    const id = crypto.randomUUID();
    const refreshToken = randomToken();
    const tokenHash = await sha256Hex(refreshToken);
    await deps.db
      .prepare(
        `INSERT INTO device_refresh_token (
          id, token_hash, family_id, user_id, session_id, client_id, scope,
          created_at, expires_at, consumed_at, replaced_by_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)`,
      )
      .bind(
        id,
        tokenHash,
        input.familyId,
        input.userId,
        input.sessionId,
        input.clientId,
        input.scope,
        input.createdAt,
        input.createdAt + REFRESH_TOKEN_TTL_SECONDS * 1_000,
      )
      .run();
    return { id, refreshToken };
  }

  async function deleteFamily(familyId: string) {
    await deps.db
      .prepare("DELETE FROM device_refresh_token WHERE family_id = ?")
      .bind(familyId)
      .run();
  }

  async function revokeFamily(familyId: string) {
    const familyRows = await deps.db
      .prepare("SELECT session_id FROM device_refresh_token WHERE family_id = ?")
      .bind(familyId)
      .all<FamilySessionRow>();

    for (const familyRow of familyRows.results) {
      if (familyRow.session_id === null) continue;
      const session = await deps.db
        .prepare("SELECT token FROM session WHERE id = ?")
        .bind(familyRow.session_id)
        .first<SessionTokenRow>();
      if (session) await deps.sessions.deleteSession(session.token);
    }

    await deleteFamily(familyId);
  }

  return {
    async issueForAccessToken(input: {
      accessToken: string;
      clientId: string;
      scope?: string;
    }): Promise<{ refreshToken: string; expiresIn: number } | null> {
      const session = await deps.db
        .prepare("SELECT id, userId FROM session WHERE token = ?")
        .bind(input.accessToken)
        .first<SessionIdentityRow>();
      if (!session) return null;

      const issuedAt = now();
      const refresh = await insertRefreshToken({
        familyId: crypto.randomUUID(),
        userId: session.userId,
        sessionId: session.id,
        clientId: input.clientId,
        scope: input.scope ?? null,
        createdAt: issuedAt,
      });
      return {
        refreshToken: refresh.refreshToken,
        expiresIn: REFRESH_TOKEN_TTL_SECONDS,
      };
    },

    async refresh(input: {
      refreshToken: string | undefined;
      clientId: string | undefined;
    }): Promise<RefreshResult> {
      if (!input.refreshToken || !input.clientId) {
        return { ok: false, error: "invalid_request" };
      }

      const tokenHash = await sha256Hex(input.refreshToken);
      const row = await deps.db
        .prepare("SELECT * FROM device_refresh_token WHERE token_hash = ?")
        .bind(tokenHash)
        .first<RefreshTokenRow>();
      if (!row) return { ok: false, error: "invalid_grant" };

      if (row.consumed_at !== null) {
        await revokeFamily(row.family_id);
        return { ok: false, error: "invalid_grant" };
      }

      const refreshedAt = now();
      if (row.expires_at <= refreshedAt) {
        await deps.db
          .prepare("DELETE FROM device_refresh_token WHERE id = ?")
          .bind(row.id)
          .run();
        return { ok: false, error: "invalid_grant" };
      }

      if (row.client_id !== input.clientId) {
        return { ok: false, error: "invalid_grant" };
      }

      if (row.session_id === null) {
        await deleteFamily(row.family_id);
        return { ok: false, error: "invalid_grant" };
      }

      const oldSession = await deps.db
        .prepare("SELECT token FROM session WHERE id = ?")
        .bind(row.session_id)
        .first<SessionTokenRow>();
      if (!oldSession) {
        await deleteFamily(row.family_id);
        return { ok: false, error: "invalid_grant" };
      }

      if (!(await deps.isEntitled(row.user_id))) {
        return { ok: false, error: "invalid_grant" };
      }

      const consumeResult = await deps.db
        .prepare(
          "UPDATE device_refresh_token SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL",
        )
        .bind(refreshedAt, row.id)
        .run();
      if (consumeResult.meta.changes === 0) {
        await revokeFamily(row.family_id);
        return { ok: false, error: "invalid_grant" };
      }

      const newSession = await deps.sessions.createSession(row.user_id);
      const replacement = await insertRefreshToken({
        familyId: row.family_id,
        userId: row.user_id,
        sessionId: newSession.id,
        clientId: row.client_id,
        scope: row.scope,
        createdAt: refreshedAt,
      });
      await deps.db
        .prepare("UPDATE device_refresh_token SET replaced_by_id = ? WHERE id = ?")
        .bind(replacement.id, row.id)
        .run();
      await deps.sessions.deleteSession(oldSession.token);

      const body: RefreshGrantBody = {
        access_token: newSession.token,
        token_type: "Bearer",
        expires_in: Math.max(0, Math.floor((newSession.expiresAt.getTime() - refreshedAt) / 1_000)),
        refresh_token: replacement.refreshToken,
        refresh_token_expires_in: REFRESH_TOKEN_TTL_SECONDS,
      };
      if (row.scope !== null) body.scope = row.scope;
      return { ok: true, body };
    },
  };
}
