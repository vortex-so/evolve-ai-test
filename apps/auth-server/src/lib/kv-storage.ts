import type { SecondaryStorage } from "better-auth";

/**
 * Cloudflare Workers KV adapter for Better Auth's SecondaryStorage interface.
 * Used as the rate-limit backend (and any other Better Auth feature that opts
 * into secondary storage). TTL is passed through as KV's expirationTtl (seconds).
 */
export function kvSecondaryStorage(kv: KVNamespace): SecondaryStorage {
  return {
    async get(key) {
      return await kv.get(key);
    },
    async set(key, value, ttl) {
      const v = typeof value === "string" ? value : JSON.stringify(value);
      await kv.put(key, v, ttl ? { expirationTtl: ttl } : undefined);
    },
    async delete(key) {
      await kv.delete(key);
    },
  };
}
