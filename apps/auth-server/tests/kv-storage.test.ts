import { describe, expect, it, vi } from "vitest";
import { kvSecondaryStorage } from "../src/lib/kv-storage";

type KV = Parameters<typeof kvSecondaryStorage>[0];

function rateLimited() {
  return new Error("KV PUT failed: 429 Too Many Requests");
}

function fakeKv(overrides: Partial<Record<"get" | "put" | "delete", ReturnType<typeof vi.fn>>>) {
  return {
    get: overrides.get ?? vi.fn(async () => null),
    put: overrides.put ?? vi.fn(async () => undefined),
    delete: overrides.delete ?? vi.fn(async () => undefined),
  } as unknown as KV;
}

describe("kvSecondaryStorage", () => {
  it("retries a rate-limited put and then succeeds", async () => {
    const put = vi.fn().mockRejectedValueOnce(rateLimited()).mockResolvedValueOnce(undefined);
    const sleep = vi.fn(async () => undefined);
    const storage = kvSecondaryStorage(fakeKv({ put }), { sleep });

    await storage.set("active-sessions-u1", "[]", 120);

    expect(put).toHaveBeenCalledTimes(2);
    expect(put).toHaveBeenLastCalledWith("active-sessions-u1", "[]", { expirationTtl: 120 });
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep.mock.calls[0]?.[0]).toBeGreaterThanOrEqual(1000);
  });

  it("retries a rate-limited delete", async () => {
    const del = vi.fn().mockRejectedValueOnce(rateLimited()).mockResolvedValueOnce(undefined);
    const storage = kvSecondaryStorage(fakeKv({ delete: del }), { sleep: async () => undefined });

    await storage.delete("active-sessions-u1");

    expect(del).toHaveBeenCalledTimes(2);
  });

  it("gives up after the retry budget and rethrows the rate-limit error", async () => {
    const put = vi.fn().mockRejectedValue(rateLimited());
    const storage = kvSecondaryStorage(fakeKv({ put }), { sleep: async () => undefined });

    await expect(storage.set("k", "v")).rejects.toThrow(/429/);
    expect(put).toHaveBeenCalledTimes(3);
  });

  it("does not retry other errors", async () => {
    const put = vi.fn().mockRejectedValue(new Error("KV PUT failed: 500 Internal Error"));
    const sleep = vi.fn(async () => undefined);
    const storage = kvSecondaryStorage(fakeKv({ put }), { sleep });

    await expect(storage.set("k", "v")).rejects.toThrow(/500/);
    expect(put).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });
});
