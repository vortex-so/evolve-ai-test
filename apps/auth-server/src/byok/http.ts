import type { Context } from "hono";
import type { AdminApp } from "../lib/admin-guard";
import { parseBoundedJsonText } from "./validation";

export function byokJsonError(error: string, status: number): Response {
  return new Response(JSON.stringify({ error, code: error }), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

export async function readByokJson(c: Context<AdminApp>): Promise<unknown> {
  const declared = Number(c.req.header("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > 65_536) throw new Error("payload_too_large");
  return parseBoundedJsonText(await c.req.text());
}
