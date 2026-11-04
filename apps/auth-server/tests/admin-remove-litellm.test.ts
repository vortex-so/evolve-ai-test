import { afterEach, describe, expect, it, vi } from "vitest";
import {
  adminSession,
  requestApp,
  TEST_CONSOLE_ORIGIN,
} from "./_helpers/test-app";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("admin user removal LiteLLM cleanup", () => {
  it("deletes the LiteLLM key by alias after successful delete and audit", async () => {
    const upstreamFetch = vi.fn<typeof fetch>(async () => Response.json({ ok: true }));
    vi.stubGlobal("fetch", upstreamFetch);

    const { response, DB } = await requestApp("/api/auth/admin/remove-user", {
      method: "POST",
      origin: TEST_CONSOLE_ORIGIN,
      session: adminSession(),
      body: { userId: "target-user-id" },
      plans: [
        {
          match: /SELECT key_alias FROM litellm_user_key/i,
          first: { key_alias: "vortex-sso:target-user-id:stored" },
        },
        {
          match: /DELETE\s+FROM\s+user\s+WHERE\s+id\s*=\s*\?/i,
          run: { meta: { changes: 1 } },
        },
      ],
    });

    expect(response.status).toBe(200);
    expect(DB.statements.some(({ sql }) => /INSERT\s+INTO\s+audit_log/i.test(sql))).toBe(true);
    expect(upstreamFetch).toHaveBeenCalledTimes(1);
    const [input, init] = upstreamFetch.mock.calls[0] ?? [];
    expect(String(input)).toBe("https://llm-manager.example.test/key/delete");
    expect(JSON.parse(String(init?.body))).toEqual({
      key_aliases: ["vortex-sso:target-user-id:stored"],
    });
  });

  it("does not delete the LiteLLM key when the delete guard fails", async () => {
    const upstreamFetch = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", upstreamFetch);

    const { response } = await requestApp("/api/auth/admin/remove-user", {
      method: "POST",
      origin: TEST_CONSOLE_ORIGIN,
      session: adminSession(),
      body: { userId: "last-admin-id" },
      plans: [
        {
          match: /SELECT key_alias FROM litellm_user_key/i,
          first: { key_alias: "vortex-sso:last-admin-id:stored" },
        },
        {
          match: /DELETE\s+FROM\s+user\s+WHERE\s+id\s*=\s*\?/i,
          run: { meta: { changes: 0 } },
        },
      ],
    });

    expect(response.status).toBe(409);
    expect(upstreamFetch).not.toHaveBeenCalled();
  });
});
