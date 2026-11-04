import { describe, expect, it } from "vitest";
import {
  createLitellmClient,
  LitellmError,
} from "../src/lib/litellm";

type RecordedRequest = {
  url: string;
  init: RequestInit | undefined;
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function createFetchStub(results: Array<Response | Error>): {
  fetch: typeof fetch;
  requests: RecordedRequest[];
} {
  const requests: RecordedRequest[] = [];
  let index = 0;

  const stub: typeof fetch = async (input, init) => {
    requests.push({
      url:
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url,
      init,
    });

    const result = results[index];
    index += 1;
    if (!result) {
      throw new Error("Unexpected fetch call");
    }
    if (result instanceof Error) {
      throw result;
    }
    return result;
  };

  return { fetch: stub, requests };
}

function parseBody(request: RecordedRequest): unknown {
  expect(typeof request.init?.body).toBe("string");
  return JSON.parse(request.init?.body as string);
}

describe("LiteLLM management client", () => {
  it("findUserByEmail returns only the exact case-insensitive match", async () => {
    const stub = createFetchStub([
      jsonResponse({
        users: [{ user_id: "partial", user_email: "target+old@example.com" }],
        total: 2,
        page: 1,
        page_size: 100,
        total_pages: 2,
      }),
      jsonResponse({
        users: [{ user_id: "exact", user_email: "target@example.com" }],
        total: 2,
        page: 2,
        page_size: 100,
        total_pages: 2,
      }),
    ]);
    const client = createLitellmClient({
      baseUrl: "https://llm-manager.fly.dev/",
      adminKey: "management-key",
      fetch: stub.fetch,
    });

    await expect(client.findUserByEmail("  TARGET@example.com ")).resolves.toEqual({
      user_id: "exact",
      user_email: "target@example.com",
    });
    expect(stub.requests.map(({ url }) => url)).toEqual([
      "https://llm-manager.fly.dev/user/list?user_email=TARGET%40example.com&page=1&page_size=100",
      "https://llm-manager.fly.dev/user/list?user_email=TARGET%40example.com&page=2&page_size=100",
    ]);
    expect(stub.requests[0]?.init?.method).toBe("GET");
    expect(stub.requests[0]?.init?.headers).toEqual({
      Authorization: "Bearer management-key",
    });
  });

  it("findUserByEmail returns null when only partial matches exist", async () => {
    const stub = createFetchStub([
      jsonResponse({
        users: [
          { user_id: "one", user_email: "person+archive@example.com" },
          { user_id: "two", user_email: "other-person@example.com" },
        ],
        total: 2,
        page: 1,
        page_size: 100,
        total_pages: 1,
      }),
    ]);
    const client = createLitellmClient({
      baseUrl: "https://llm-manager.fly.dev",
      adminKey: "management-key",
      fetch: stub.fetch,
    });

    await expect(client.findUserByEmail("person@example.com")).resolves.toBeNull();
    expect(stub.requests).toHaveLength(1);
  });

  it("createUser posts internal_user with auto_create_key false and send_invite_email false", async () => {
    const stub = createFetchStub([jsonResponse({ user_id: "user-123" })]);
    const client = createLitellmClient({
      baseUrl: "https://llm-manager.fly.dev/",
      adminKey: "management-key",
      fetch: stub.fetch,
    });

    await expect(
      client.createUser({
        userId: "user-123",
        email: "person@example.com",
        metadata: { source: "worker" },
      }),
    ).resolves.toEqual({ user_id: "user-123" });
    expect(stub.requests[0]?.url).toBe("https://llm-manager.fly.dev/user/new");
    expect(stub.requests[0]?.init?.method).toBe("POST");
    expect(stub.requests[0]?.init?.headers).toEqual({
      Authorization: "Bearer management-key",
      "content-type": "application/json",
    });
    expect(parseBody(stub.requests[0]!)).toEqual({
      user_id: "user-123",
      user_email: "person@example.com",
      user_role: "internal_user",
      auto_create_key: false,
      send_invite_email: false,
      metadata: { source: "worker" },
    });
  });

  it("createUser surfaces 409 as LitellmError", async () => {
    const stub = createFetchStub([
      jsonResponse({ detail: { message: "User already exists", type: "conflict" } }, 409),
    ]);
    const client = createLitellmClient({
      baseUrl: "https://llm-manager.fly.dev",
      adminKey: "management-key",
      fetch: stub.fetch,
    });

    const error = await client
      .createUser({ userId: "duplicate", email: "duplicate@example.com" })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(LitellmError);
    expect(error).toMatchObject({
      status: 409,
      message: "User already exists",
      type: "conflict",
    });
  });

  it("generateKey creates an inference key without MCP object permissions", async () => {
    const stub = createFetchStub([
      jsonResponse({ key: "sk-plaintext-once", token_id: "token-123" }),
      jsonResponse({ key: "sk-without-token-id" }),
    ]);
    const client = createLitellmClient({
      baseUrl: "https://llm-manager.fly.dev",
      adminKey: "management-key",
      fetch: stub.fetch,
    });

    await expect(
      client.generateKey({
        userId: "user-123",
        keyAlias: "claude-desktop:user-123",
        metadata: { provisionedBy: "auth-worker" },
        purpose: "inference",
      }),
    ).resolves.toEqual({ key: "sk-plaintext-once", tokenId: "token-123" });
    expect(stub.requests[0]?.url).toBe("https://llm-manager.fly.dev/key/generate");
    expect(stub.requests[0]?.init?.method).toBe("POST");
    expect(stub.requests[0]?.init?.headers).toEqual({
      Authorization: "Bearer management-key",
      "content-type": "application/json",
    });
    expect(parseBody(stub.requests[0]!)).toEqual({
      user_id: "user-123",
      key_alias: "claude-desktop:user-123",
      metadata: { provisionedBy: "auth-worker" },
      models: [],
      max_budget: null,
      key_type: "llm_api",
    });
    await expect(
      client.generateKey({
        userId: "user-123",
        keyAlias: "alias-without-token-id",
        purpose: "inference",
      }),
    ).resolves.toEqual({ key: "sk-without-token-id", tokenId: null });
  });

  it("generateKey creates an MCP-only key with group access and no default models", async () => {
    const stub = createFetchStub([
      jsonResponse({ key: "sk-mcp", token_id: "mcp-token" }),
    ]);
    const client = createLitellmClient({
      baseUrl: "https://llm-manager.fly.dev",
      adminKey: "management-key",
      fetch: stub.fetch,
    });

    await client.generateKey({
      userId: "user-123",
      keyAlias: "vortex-sso-mcp:user-123",
      purpose: "mcp",
      mcpAccessGroup: "vortex-claude-desktop",
    });

    expect(parseBody(stub.requests[0]!)).toEqual({
      user_id: "user-123",
      key_alias: "vortex-sso-mcp:user-123",
      metadata: {},
      models: ["no-default-models"],
      max_budget: null,
      key_type: "llm_api",
      object_permission: {
        mcp_access_groups: ["vortex-claude-desktop"],
      },
    });
  });

  it("deleteKeysByAlias posts key_aliases and tolerates 404", async () => {
    const stub = createFetchStub([
      jsonResponse({ detail: "No matching keys" }, 404),
    ]);
    const client = createLitellmClient({
      baseUrl: "https://llm-manager.fly.dev",
      adminKey: "management-key",
      fetch: stub.fetch,
    });

    await expect(
      client.deleteKeysByAlias(["claude-desktop:user-1", "claude-desktop:user-2"]),
    ).resolves.toBeUndefined();
    expect(stub.requests[0]?.url).toBe("https://llm-manager.fly.dev/key/delete");
    expect(stub.requests[0]?.init?.method).toBe("POST");
    expect(stub.requests[0]?.init?.headers).toEqual({
      Authorization: "Bearer management-key",
      "content-type": "application/json",
    });
    expect(parseBody(stub.requests[0]!)).toEqual({
      key_aliases: ["claude-desktop:user-1", "claude-desktop:user-2"],
    });

    await expect(client.deleteKeysByAlias([])).resolves.toBeUndefined();
    expect(stub.requests).toHaveLength(1);
  });

  it("maps the LiteLLM error envelope to LitellmError(status, message, type)", async () => {
    const stub = createFetchStub([
      jsonResponse(
        {
          error: {
            message: "Invalid management request",
            type: "invalid_request_error",
            code: "400",
          },
        },
        400,
      ),
    ]);
    const client = createLitellmClient({
      baseUrl: "https://llm-manager.fly.dev",
      adminKey: "management-key",
      fetch: stub.fetch,
    });

    const error = await client
      .generateKey({ userId: "user-123", keyAlias: "alias", purpose: "inference" })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(LitellmError);
    expect(error).toMatchObject({
      status: 400,
      message: "Invalid management request",
      type: "invalid_request_error",
    });
  });

  it("never leaks the admin key in error messages", async () => {
    const adminKey = "super-secret-management-key";
    const stub = createFetchStub([
      jsonResponse(
        { error: { message: `Invalid bearer ${adminKey}`, type: "authentication_error" } },
        401,
      ),
    ]);
    const client = createLitellmClient({
      baseUrl: "https://llm-manager.fly.dev",
      adminKey,
      fetch: stub.fetch,
    });

    const error = await client
      .createUser({ userId: "user-123", email: "person@example.com" })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(LitellmError);
    expect((error as LitellmError).message).not.toContain(adminKey);
  });

  it("wraps network failures as LitellmError(0)", async () => {
    const stub = createFetchStub([new Error("socket closed")]);
    const client = createLitellmClient({
      baseUrl: "https://llm-manager.fly.dev",
      adminKey: "management-key",
      fetch: stub.fetch,
    });

    const error = await client
      .findUserByEmail("person@example.com")
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(LitellmError);
    expect(error).toMatchObject({
      status: 0,
      message: "LiteLLM unreachable: socket closed",
    });
  });
});
