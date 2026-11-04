import type { SecondaryStorage } from "better-auth";

const WRITE_RETRY_DELAYS_MS = [1_100, 2_200];

function isRateLimited(error: unknown): boolean {
  return error instanceof Error && /\b429\b|too many requests/i.test(error.message);
}

/**
 * Cloudflare Workers KV adapter for Better Auth's SecondaryStorage interface.
 * Used as the rate-limit backend (and any other Better Auth feature that opts
 * into secondary storage). TTL is passed through as KV's expirationTtl (seconds).
 *
 * KV accepts about one write per second per key, and Better Auth rewrites the
 * `active-sessions-<userId>` list on every session create/delete, so writes that
 * KV rejects with 429 are retried after a short wait.
 */
export function kvSecondaryStorage(
  kv: KVNamespace,
  options: { sleep?: (ms: number) => Promise<void> } = {},
): SecondaryStorage {
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  async function write(operation: () => Promise<void>): Promise<void> {
    for (let attempt = 0; ; attempt++) {
      try {
        await operation();
        return;
      } catch (error) {
        const delay = WRITE_RETRY_DELAYS_MS[attempt];
        if (!isRateLimited(error) || delay === undefined) throw error;
        await sleep(delay);
      }
    }
  }

  return {
    async get(key) {
      return await kv.get(key);
    },
    async set(key, value, ttl) {
      const v = typeof value === "string" ? value : JSON.stringify(value);
      await write(() => kv.put(key, v, ttl ? { expirationTtl: ttl } : undefined));
    },
    async delete(key) {
      await write(() => kv.delete(key));
    },
  };
}
