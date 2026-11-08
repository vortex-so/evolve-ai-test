import { resolveOdooAliases } from "./routing";

type RpcEnvelope = { result?: unknown; error?: unknown };

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

async function rpc(input: {
  url: string;
  key: string;
  identity: string;
  identityHeader: string;
  method: string;
  params: object;
  id: number;
  sessionId?: string;
  fetchImpl: typeof fetch;
}): Promise<{ body: RpcEnvelope; sessionId?: string }> {
  const headers = new Headers({
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    "x-litellm-api-key": `Bearer ${input.key}`,
  });
  headers.set(input.identityHeader, `Bearer ${input.identity}`);
  if (input.sessionId) headers.set("mcp-session-id", input.sessionId);
  const fetchImpl = input.fetchImpl;
  const response = await fetchImpl(input.url, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id: input.id, method: input.method, params: input.params }),
    redirect: "manual",
  });
  if (!response.ok) throw new Error(`odoo test upstream rejected (${response.status})`);
  const text = await response.text();
  let body: RpcEnvelope;
  if (response.headers.get("content-type")?.includes("text/event-stream")) {
    const data = text.split(/\r?\n/).find((line) => line.startsWith("data:"))?.slice(5).trim();
    if (!data) throw new Error("odoo test SSE response missing data");
    body = JSON.parse(data) as RpcEnvelope;
  } else {
    body = JSON.parse(text) as RpcEnvelope;
  }
  if (body.error !== undefined) throw new Error("odoo test rpc failed");
  return { body, sessionId: response.headers.get("mcp-session-id") ?? input.sessionId };
}

function extractUid(value: unknown): number | null {
  if (typeof value === "string" && value.length <= 4096) {
    try {
      return extractUid(JSON.parse(value) as unknown);
    } catch {
      return null;
    }
  }
  const root = record(value);
  if (!root) return null;
  if (typeof root.uid === "number" && Number.isInteger(root.uid) && root.uid > 0) return root.uid;
  for (const nested of Object.values(root)) {
    if (Array.isArray(nested)) {
      for (const item of nested) {
        const uid = extractUid(item);
        if (uid) return uid;
      }
    } else {
      const uid = extractUid(nested);
      if (uid) return uid;
    }
  }
  return null;
}

export async function testOdooConnection(input: {
  baseUrl: string;
  serviceKey: string;
  assertion: string;
  serverAlias?: string;
  fetch?: typeof fetch;
}): Promise<number> {
  const fetchImpl = input.fetch ?? fetch;
  const serverAlias = resolveOdooAliases({ ODOO_TEST_MCP_ALIAS: input.serverAlias }).test;
  const url = `${input.baseUrl.replace(/\/+$/, "")}/${serverAlias}/mcp`;
  const identityHeader = `x-mcp-${serverAlias}-x-vortex-identity`;
  const initialized = await rpc({
    url, key: input.serviceKey, identity: input.assertion, identityHeader, method: "initialize", id: 1,
    params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "vortex-auth", version: "1" } },
    fetchImpl,
  });
  const listed = await rpc({
    url, key: input.serviceKey, identity: input.assertion, identityHeader, method: "tools/list", id: 2,
    params: {}, sessionId: initialized.sessionId, fetchImpl,
  });
  const listResult = record(listed.body.result);
  const tools = listResult?.tools;
  const allowedNames = new Set(["test_connection", `${serverAlias}-test_connection`]);
  const candidates = Array.isArray(tools)
    ? tools.filter((tool) => {
        const name = record(tool)?.name;
        return typeof name === "string" && allowedNames.has(name);
      })
    : [];
  if (candidates.length !== 1) {
    throw new Error("test_connection tool unavailable");
  }
  const toolName = record(candidates[0])?.name;
  if (typeof toolName !== "string") throw new Error("test_connection tool unavailable");
  const called = await rpc({
    url, key: input.serviceKey, identity: input.assertion, identityHeader, method: "tools/call", id: 3,
    params: { name: toolName, arguments: {} }, sessionId: listed.sessionId, fetchImpl,
  });
  if (record(called.body.result)?.isError === true) throw new Error("test_connection tool failed");
  const uid = extractUid(called.body.result);
  if (!uid) throw new Error("test response missing uid");
  return uid;
}
