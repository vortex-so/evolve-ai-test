import { describe, expect, it, vi } from "vitest";
import { testOdooConnection } from "../src/byok/test-client";

describe("BYOK Odoo test client", () => {
  it("uses only the dedicated restricted LiteLLM key and test_connection tool", async () => {
    const requests: Request[] = [];
    const fetchStub = vi.fn<typeof fetch>(async (input, init) => {
      const request = new Request(input, init);
      requests.push(request);
      const rpc = await request.clone().json() as { method: string };
      if (rpc.method === "initialize") {
        return Response.json({ jsonrpc: "2.0", id: 1, result: {} }, { headers: { "mcp-session-id": "session-1" } });
      }
      if (rpc.method === "tools/list") {
        return Response.json({ jsonrpc: "2.0", id: 2, result: { tools: [{ name: "test_connection" }] } });
      }
      return Response.json({ jsonrpc: "2.0", id: 3, result: { content: [{ type: "json", uid: 17 }] } });
    });

    await expect(testOdooConnection({
      baseUrl: "https://litellm.example.test/",
      serviceKey: "dedicated-test-key",
      assertion: "signed-test-identity",
      fetch: fetchStub,
    })).resolves.toBe(17);

    expect(requests).toHaveLength(3);
    for (const request of requests) {
      expect(request.url).toBe("https://litellm.example.test/odoo_test/mcp");
      expect(request.headers.get("x-litellm-api-key")).toBe("Bearer dedicated-test-key");
      expect(request.headers.get("authorization")).toBeNull();
      expect(request.headers.get("x-mcp-odoo_test-x-vortex-identity")).toBe("Bearer signed-test-identity");
      expect(request.headers.get("x-mcp-odoo-x-vortex-identity")).toBeNull();
    }
    expect((await requests[2]!.clone().json()) as object).toMatchObject({
      method: "tools/call",
      params: { name: "test_connection", arguments: {} },
    });
  });

  it("invokes fetch unbound, as the Workers runtime requires", async () => {
    const workersFetch = vi.fn<typeof fetch>(async function (this: unknown, _input, init) {
      if (this !== undefined && this !== globalThis) {
        throw new TypeError("Illegal invocation: function called with incorrect `this` reference.");
      }
      const rpc = JSON.parse(String(init?.body)) as { method: string };
      if (rpc.method === "tools/list") {
        return Response.json({ jsonrpc: "2.0", id: 2, result: { tools: [{ name: "odoo_prod_test-test_connection" }] } });
      }
      if (rpc.method === "tools/call") {
        return Response.json({ jsonrpc: "2.0", id: 3, result: { structuredContent: { ok: true, uid: 41 } } });
      }
      return Response.json({ jsonrpc: "2.0", id: 1, result: {} });
    });
    await expect(testOdooConnection({
      baseUrl: "https://litellm.example.test",
      serviceKey: "dedicated-test-key",
      assertion: "signed-test-identity",
      serverAlias: "odoo_prod_test",
      fetch: workersFetch,
    })).resolves.toBe(41);
  });

  it("accepts SSE JSON-RPC envelopes and a JSON text uid result", async () => {
    const responses = [
      { result: {} },
      { result: { tools: [{ name: "test_connection" }] } },
      { result: { content: [{ type: "text", text: "{\"uid\":23}" }] } },
    ];
    let index = 0;
    const fetchStub = vi.fn<typeof fetch>(async () => {
      const body = responses[index++];
      return new Response(`event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: index, ...body })}\n\n`, {
        headers: { "content-type": "text/event-stream" },
      });
    });
    await expect(testOdooConnection({
      baseUrl: "https://litellm.example.test",
      serviceKey: "dedicated-test-key",
      assertion: "signed-test-identity",
      fetch: fetchStub,
    })).resolves.toBe(23);
  });

  it("uses the configured test alias and calls the exact qualified tool name", async () => {
    const requests: Request[] = [];
    const fetchStub = vi.fn<typeof fetch>(async (input, init) => {
      const request = new Request(input, init);
      requests.push(request);
      const rpc = await request.clone().json() as { method: string };
      if (rpc.method === "tools/list") {
        return Response.json({ jsonrpc: "2.0", id: 2, result: { tools: [{ name: "odoo_prod_test-test_connection" }] } });
      }
      if (rpc.method === "tools/call") {
        return Response.json({ jsonrpc: "2.0", id: 3, result: { uid: 31 } });
      }
      return Response.json({ jsonrpc: "2.0", id: 1, result: {} });
    });
    await expect(testOdooConnection({
      baseUrl: "https://litellm.example.test",
      serviceKey: "dedicated-test-key",
      assertion: "signed-test-identity",
      serverAlias: "odoo_prod_test",
      fetch: fetchStub,
    })).resolves.toBe(31);
    expect(requests[0]?.url).toBe("https://litellm.example.test/odoo_prod_test/mcp");
    expect(requests[0]?.headers.get("x-mcp-odoo_prod_test-x-vortex-identity")).toBe("Bearer signed-test-identity");
    expect(await requests[2]!.clone().json()).toMatchObject({
      params: { name: "odoo_prod_test-test_connection" },
    });
  });

  it.each([
    [{ name: "other-test_connection" }],
    [{ name: "test_connection" }, { name: "test_connection" }],
    [{ name: "test_connection" }, { name: "odoo_prod_test-test_connection" }],
  ])("rejects wrong namespaces, duplicates, and ambiguous tool lists", async (...tools) => {
    const fetchStub = vi.fn<typeof fetch>(async (_input, init) => {
      const rpc = JSON.parse(String(init?.body)) as { method: string };
      if (rpc.method === "tools/list") {
        return Response.json({ jsonrpc: "2.0", id: 2, result: { tools } });
      }
      return Response.json({ jsonrpc: "2.0", id: 1, result: {} });
    });
    await expect(testOdooConnection({
      baseUrl: "https://litellm.example.test",
      serviceKey: "dedicated-test-key",
      assertion: "signed-test-identity",
      serverAlias: "odoo_prod_test",
      fetch: fetchStub,
    })).rejects.toThrow("test_connection tool unavailable");
  });

  it("rejects isError tool results even when a uid is present", async () => {
    const fetchStub = vi.fn<typeof fetch>(async (_input, init) => {
      const rpc = JSON.parse(String(init?.body)) as { method: string };
      if (rpc.method === "tools/list") {
        return Response.json({ jsonrpc: "2.0", id: 2, result: { tools: [{ name: "test_connection" }] } });
      }
      if (rpc.method === "tools/call") {
        return Response.json({ jsonrpc: "2.0", id: 3, result: { isError: true, uid: 99 } });
      }
      return Response.json({ jsonrpc: "2.0", id: 1, result: {} });
    });
    await expect(testOdooConnection({
      baseUrl: "https://litellm.example.test",
      serviceKey: "dedicated-test-key",
      assertion: "signed-test-identity",
      fetch: fetchStub,
    })).rejects.toThrow("test_connection tool failed");
  });
});
