import { describe, expect, it } from "vitest";
import {
  createRefreshTokenService,
  REFRESH_TOKEN_TTL_SECONDS,
  type SessionPort,
} from "../src/lib/refresh-token";
import { FakeD1, type FakeSessionRow } from "./_helpers/fake-d1";

const NOW = 1_730_678_400_000;

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function createHarness(options: { entitled?: boolean; now?: number } = {}) {
  const db = new FakeD1();
  let currentNow = options.now ?? NOW;
  let sessionSequence = 0;
  const deletedSessionTokens: string[] = [];
  const tokenQueue = ["opaque-refresh-one", "opaque-refresh-two", "opaque-refresh-three"];
  const sessions: SessionPort = {
    async createSession(userId) {
      sessionSequence += 1;
      const session = {
        id: `new-session-${sessionSequence}`,
        token: `new-access-${sessionSequence}`,
        expiresAt: new Date(currentNow + 3_601_999),
      };
      db.sessions.push({ ...session, userId });
      return session;
    },
    async deleteSession(token) {
      deletedSessionTokens.push(token);
      const index = db.sessions.findIndex((session) => session.token === token);
      if (index >= 0) db.sessions.splice(index, 1);
    },
  };
  const service = createRefreshTokenService({
    db: db.database,
    sessions,
    isEntitled: async () => options.entitled ?? true,
    now: () => currentNow,
    randomToken: () => tokenQueue.shift() ?? `opaque-refresh-${crypto.randomUUID()}`,
  });

  function addSession(overrides: Partial<FakeSessionRow> = {}) {
    const row: FakeSessionRow = {
      id: "old-session",
      token: "old-access",
      userId: "user-1",
      expiresAt: new Date(currentNow + 60_000),
      ...overrides,
    };
    db.sessions.push(row);
    return row;
  }

  return {
    db,
    service,
    deletedSessionTokens,
    addSession,
    setNow(value: number) {
      currentNow = value;
    },
  };
}

async function issueDefault(harness: ReturnType<typeof createHarness>, scope?: string) {
  harness.addSession();
  const issued = await harness.service.issueForAccessToken({
    accessToken: "old-access",
    clientId: "claude-desktop",
    scope,
  });
  if (!issued) throw new Error("Expected refresh token issuance");
  return issued;
}

describe("refresh token service", () => {
  it("issueForAccessToken stores only a sha-256 hash and returns an opaque token", async () => {
    const harness = createHarness();
    const issued = await issueDefault(harness, "openid offline_access");

    expect(issued).toEqual({
      refreshToken: "opaque-refresh-one",
      expiresIn: REFRESH_TOKEN_TTL_SECONDS,
    });
    expect(harness.db.refreshTokens).toHaveLength(1);
    expect(harness.db.refreshTokens[0]?.token_hash).toBe(await sha256("opaque-refresh-one"));
    expect(JSON.stringify(harness.db.refreshTokens[0])).not.toContain("opaque-refresh-one");
    expect(harness.db.refreshTokens[0]?.scope).toBe("openid offline_access");
  });

  it("issueForAccessToken returns null for an unknown access token", async () => {
    const harness = createHarness();

    await expect(
      harness.service.issueForAccessToken({
        accessToken: "unknown",
        clientId: "claude-desktop",
      }),
    ).resolves.toBeNull();
    expect(harness.db.refreshTokens).toHaveLength(0);
  });

  it("refresh rotates: new access + refresh token, old consumed, old session deleted, same family", async () => {
    const harness = createHarness();
    const issued = await issueDefault(harness, "bootstrap:read");
    const oldRow = harness.db.refreshTokens[0];

    const result = await harness.service.refresh({
      refreshToken: issued.refreshToken,
      clientId: "claude-desktop",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body.access_token).toBe("new-access-1");
    expect(result.body.refresh_token).toBe("opaque-refresh-two");
    expect(oldRow?.consumed_at).toBe(NOW);
    expect(oldRow?.replaced_by_id).toBe(harness.db.refreshTokens[1]?.id);
    expect(harness.db.refreshTokens[1]?.family_id).toBe(oldRow?.family_id);
    expect(harness.db.refreshTokens[1]?.session_id).toBe("new-session-1");
    expect(harness.deletedSessionTokens).toEqual(["old-access"]);
  });

  it("refresh body uses Bearer, 7-day refresh expiry and the new session expiry", async () => {
    const harness = createHarness();
    const issued = await issueDefault(harness, "bootstrap:read");

    const result = await harness.service.refresh({
      refreshToken: issued.refreshToken,
      clientId: "claude-desktop",
    });

    expect(result).toEqual({
      ok: true,
      body: {
        access_token: "new-access-1",
        token_type: "Bearer",
        expires_in: 3601,
        refresh_token: "opaque-refresh-two",
        refresh_token_expires_in: 604_800,
        scope: "bootstrap:read",
      },
    });
  });

  it("reusing a consumed token revokes the whole family and its sessions", async () => {
    const harness = createHarness();
    const issued = await issueDefault(harness);
    await harness.service.refresh({
      refreshToken: issued.refreshToken,
      clientId: "claude-desktop",
    });

    const result = await harness.service.refresh({
      refreshToken: issued.refreshToken,
      clientId: "claude-desktop",
    });

    expect(result).toEqual({ ok: false, error: "invalid_grant" });
    expect(harness.deletedSessionTokens).toEqual(["old-access", "new-access-1"]);
    expect(harness.db.refreshTokens).toHaveLength(0);
  });

  it("expired token → invalid_grant", async () => {
    const harness = createHarness();
    const issued = await issueDefault(harness);
    harness.setNow(NOW + REFRESH_TOKEN_TTL_SECONDS * 1_000);

    await expect(
      harness.service.refresh({
        refreshToken: issued.refreshToken,
        clientId: "claude-desktop",
      }),
    ).resolves.toEqual({ ok: false, error: "invalid_grant" });
    expect(harness.db.refreshTokens).toHaveLength(0);
  });

  it("unknown token → invalid_grant", async () => {
    const harness = createHarness();

    await expect(
      harness.service.refresh({
        refreshToken: "unknown",
        clientId: "claude-desktop",
      }),
    ).resolves.toEqual({ ok: false, error: "invalid_grant" });
  });

  it("client_id mismatch → invalid_grant and token stays usable", async () => {
    const harness = createHarness();
    const issued = await issueDefault(harness);

    await expect(
      harness.service.refresh({
        refreshToken: issued.refreshToken,
        clientId: "other-client",
      }),
    ).resolves.toEqual({ ok: false, error: "invalid_grant" });
    expect(harness.db.refreshTokens[0]?.consumed_at).toBeNull();

    const retry = await harness.service.refresh({
      refreshToken: issued.refreshToken,
      clientId: "claude-desktop",
    });
    expect(retry.ok).toBe(true);
  });

  it("revoked session → invalid_grant", async () => {
    const harness = createHarness();
    const issued = await issueDefault(harness);
    harness.db.sessions.splice(0);

    await expect(
      harness.service.refresh({
        refreshToken: issued.refreshToken,
        clientId: "claude-desktop",
      }),
    ).resolves.toEqual({ ok: false, error: "invalid_grant" });
    expect(harness.db.refreshTokens).toHaveLength(0);
  });

  it("not entitled → invalid_grant", async () => {
    const harness = createHarness({ entitled: false });
    const issued = await issueDefault(harness);

    await expect(
      harness.service.refresh({
        refreshToken: issued.refreshToken,
        clientId: "claude-desktop",
      }),
    ).resolves.toEqual({ ok: false, error: "invalid_grant" });
    expect(harness.db.refreshTokens[0]?.consumed_at).toBeNull();
  });

  it("missing refresh_token or client_id → invalid_request", async () => {
    const harness = createHarness();

    await expect(
      harness.service.refresh({ refreshToken: undefined, clientId: "claude-desktop" }),
    ).resolves.toEqual({ ok: false, error: "invalid_request" });
    await expect(
      harness.service.refresh({ refreshToken: "token", clientId: "" }),
    ).resolves.toEqual({ ok: false, error: "invalid_request" });
  });

  it("concurrent consume (changes 0) is treated as reuse", async () => {
    const harness = createHarness();
    const issued = await issueDefault(harness);
    harness.db.forceNextConsumeChangesZero = true;

    await expect(
      harness.service.refresh({
        refreshToken: issued.refreshToken,
        clientId: "claude-desktop",
      }),
    ).resolves.toEqual({ ok: false, error: "invalid_grant" });
    expect(harness.deletedSessionTokens).toEqual(["old-access"]);
    expect(harness.db.refreshTokens).toHaveLength(0);
  });
});
