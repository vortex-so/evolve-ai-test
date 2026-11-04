import type * as RefreshTokenModule from "../../src/lib/refresh-token";

type RefreshTokenDatabase = Parameters<
  typeof RefreshTokenModule.createRefreshTokenService
>[0]["db"];

export type FakeSessionRow = {
  id: string;
  token: string;
  userId: string;
  expiresAt: Date;
};

export type FakeRefreshTokenRow = {
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

type D1Result = {
  success: true;
  meta: {
    changes: number;
    last_row_id: number;
    duration: number;
    served_by: string;
  };
};

function result(changes = 0): D1Result {
  return {
    success: true,
    meta: {
      changes,
      last_row_id: 0,
      duration: 0,
      served_by: "fake-d1",
    },
  };
}

function normalize(sql: string) {
  return sql.replace(/\s+/g, " ").trim().toLowerCase();
}

export class FakeD1 {
  readonly sessions: FakeSessionRow[] = [];
  readonly refreshTokens: FakeRefreshTokenRow[] = [];
  readonly statements: Array<{ sql: string; params: unknown[] }> = [];
  forceNextConsumeChangesZero = false;

  get database(): RefreshTokenDatabase {
    return this as unknown as RefreshTokenDatabase;
  }

  prepare(sql: string) {
    const normalized = normalize(sql);

    return {
      bind: (...params: unknown[]) => {
        this.statements.push({ sql, params });
        return {
          first: async <T>() => this.first(normalized, params) as T | null,
          all: async <T>() => ({ ...result(), results: this.all(normalized, params) as T[] }),
          run: async () => this.run(normalized, params),
          raw: async <T>() => this.all(normalized, params) as T[],
        };
      },
    };
  }

  private first(sql: string, params: unknown[]): unknown {
    if (sql.includes("select id, userid from session where token = ?")) {
      const row = this.sessions.find((session) => session.token === params[0]);
      return row ? { id: row.id, userId: row.userId } : null;
    }

    if (sql.includes("select token from session where id = ?")) {
      const row = this.sessions.find((session) => session.id === params[0]);
      return row ? { token: row.token } : null;
    }

    if (sql.includes("from device_refresh_token where token_hash = ?")) {
      return this.refreshTokens.find((row) => row.token_hash === params[0]) ?? null;
    }

    throw new Error(`Unsupported first() SQL: ${sql}`);
  }

  private all(sql: string, params: unknown[]): unknown[] {
    if (sql.includes("select session_id from device_refresh_token where family_id = ?")) {
      return this.refreshTokens
        .filter((row) => row.family_id === params[0])
        .map((row) => ({ session_id: row.session_id }));
    }

    throw new Error(`Unsupported all() SQL: ${sql}`);
  }

  private run(sql: string, params: unknown[]): D1Result {
    if (sql.startsWith("insert into device_refresh_token")) {
      const [
        id,
        tokenHash,
        familyId,
        userId,
        sessionId,
        clientId,
        scope,
        createdAt,
        expiresAt,
      ] = params;
      this.refreshTokens.push({
        id: String(id),
        token_hash: String(tokenHash),
        family_id: String(familyId),
        user_id: String(userId),
        session_id: sessionId === null ? null : String(sessionId),
        client_id: String(clientId),
        scope: scope === null ? null : String(scope),
        created_at: Number(createdAt),
        expires_at: Number(expiresAt),
        consumed_at: null,
        replaced_by_id: null,
      });
      return result(1);
    }

    if (sql.includes("set consumed_at = ?") && sql.includes("consumed_at is null")) {
      if (this.forceNextConsumeChangesZero) {
        this.forceNextConsumeChangesZero = false;
        return result(0);
      }
      const row = this.refreshTokens.find(
        (candidate) => candidate.id === params[1] && candidate.consumed_at === null,
      );
      if (!row) return result(0);
      row.consumed_at = Number(params[0]);
      return result(1);
    }

    if (sql.includes("set replaced_by_id = ?") && sql.includes("where id = ?")) {
      const row = this.refreshTokens.find((candidate) => candidate.id === params[1]);
      if (!row) return result(0);
      row.replaced_by_id = String(params[0]);
      return result(1);
    }

    if (sql.includes("delete from device_refresh_token where family_id = ?")) {
      const before = this.refreshTokens.length;
      const retained = this.refreshTokens.filter((row) => row.family_id !== params[0]);
      this.refreshTokens.splice(0, this.refreshTokens.length, ...retained);
      return result(before - retained.length);
    }

    if (sql.includes("delete from device_refresh_token where id = ?")) {
      const index = this.refreshTokens.findIndex((row) => row.id === params[0]);
      if (index < 0) return result(0);
      this.refreshTokens.splice(index, 1);
      return result(1);
    }

    throw new Error(`Unsupported run() SQL: ${sql}`);
  }
}
