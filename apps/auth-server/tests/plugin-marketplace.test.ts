import { describe, expect, it } from "vitest";
import {
  KVSpy,
  requestApp,
  TEST_PUBLIC_ORIGIN,
  userSession,
} from "./_helpers/test-app";

const PUBLISH_TOKEN = "publish-token-publish-token-123456";
const USER = userSession();
const ZIP_BYTES = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x01, 0x02, 0x03]);

function entitledPlan(assigned = 1) {
  return {
    match: /SELECT u\.role AS role/i,
    first: { role: "user", banned: 0, banExpires: null, assigned },
  };
}

async function sha256Hex(value: BufferSource): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", value);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function asArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function desktopHeaders(extra: HeadersInit = {}): HeadersInit {
  return { Authorization: "Bearer desktop-session", ...extra };
}

function publishHeaders(sha256?: string, contentLength?: number | string): HeadersInit {
  return {
    Authorization: `Bearer ${PUBLISH_TOKEN}`,
    ...(sha256 ? { "x-content-sha256": sha256 } : {}),
    ...(contentLength !== undefined ? { "content-length": String(contentLength) } : {}),
  };
}

async function publishArchive(
  pluginsKV: KVSpy,
  file = "example.zip",
  bytes: Uint8Array = ZIP_BYTES,
) {
  const body = asArrayBuffer(bytes);
  const sha256 = await sha256Hex(body);
  const result = await requestApp(`/claude/plugins/_publish/archives/${file}`, {
    method: "PUT",
    rawBody: body,
    origin: null,
    headers: publishHeaders(sha256, body.byteLength),
    env: { MARKETPLACE_PUBLISH_TOKEN: PUBLISH_TOKEN },
    pluginsKV,
  });
  return { ...result, sha256 };
}

function manifestFor(file: string, sha256: string, overrides: Record<string, unknown> = {}) {
  return {
    name: "vortex-marketplace",
    owner: { name: "Vortex" },
    plugins: [
      {
        name: "example-skill",
        source: {
          source: "archive",
          url: `${TEST_PUBLIC_ORIGIN}/claude/plugins/archives/${file}`,
          sha256,
        },
        installationPreference: "auto_install",
        ...overrides,
      },
    ],
    description: "Vortex skills",
    version: "1.0.0",
  };
}

describe("Claude Desktop plugin marketplace serving", () => {
  it("returns 401 with a bearer challenge without Authorization", async () => {
    const { response } = await requestApp("/claude/plugins/marketplace.json", {
      origin: null,
      session: USER,
    });

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe("Bearer");
    await expect(response.json()).resolves.toEqual({ error: "invalid_token" });
  });

  it("does not accept a cookie-only session", async () => {
    const { response } = await requestApp("/claude/plugins/marketplace.json", {
      origin: null,
      session: USER,
      headers: { cookie: "better-auth.session_token=cookie-session" },
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "invalid_token" });
  });

  it("ignores x-test-session outside the test environment", async () => {
    const { response } = await requestApp("/claude/plugins/marketplace.json", {
      origin: null,
      session: USER,
      headers: desktopHeaders(),
      env: { NODE_ENV: "production" },
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "invalid_token" });
  });

  it("returns 403 for a valid bearer session without entitlement", async () => {
    const { response } = await requestApp("/claude/plugins/marketplace.json", {
      origin: null,
      session: USER,
      headers: desktopHeaders(),
      plans: [entitledPlan(0)],
    });

    expect(response.status).toBe(403);
  });

  it("returns 404 before a manifest is published", async () => {
    const { response } = await requestApp("/claude/plugins/marketplace.json", {
      origin: null,
      session: USER,
      headers: desktopHeaders(),
      plans: [entitledPlan()],
    });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "no_marketplace" });
  });

  it("serves the exact stored manifest bytes with private no-store headers", async () => {
    const manifest = "{\n  \"name\": \"vortex-marketplace\", \"plugins\": []\n}\n";
    const { response } = await requestApp("/claude/plugins/marketplace.json", {
      origin: null,
      session: USER,
      headers: desktopHeaders(),
      plans: [entitledPlan()],
      pluginKvEntries: { "manifest:current": manifest },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.text()).toBe(manifest);
  });

  it("streams archive bytes and uses metadata for content length", async () => {
    const pluginsKV = new KVSpy({
      "archive:example.zip": {
        value: ZIP_BYTES.buffer,
        metadata: { sha256: "0".repeat(64), size: ZIP_BYTES.byteLength, uploadedAt: "2026-11-05T00:00:00.000Z" },
      },
    });
    const { response } = await requestApp("/claude/plugins/archives/example.zip", {
      origin: null,
      session: USER,
      headers: desktopHeaders(),
      plans: [entitledPlan()],
      pluginsKV,
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/zip");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("content-length")).toBe(String(ZIP_BYTES.byteLength));
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(ZIP_BYTES);
    expect(pluginsKV.reads).toEqual([
      { key: "archive:example.zip", type: "stream", withMetadata: true },
    ]);
  });

  it.each([
    "../example.zip",
    "..%2Fx.zip",
    "a%00.zip",
    "a%0a.zip",
    "A.zip",
    ".zip",
    "x",
    `${"a".repeat(129)}.zip`,
  ])(
    "returns 404 for invalid archive filename %s",
    async (file) => {
      const pluginsKV = new KVSpy();
      const { response } = await requestApp(`/claude/plugins/archives/${file}`, {
        origin: null,
        session: USER,
        headers: desktopHeaders(),
        plans: [entitledPlan()],
        pluginsKV,
      });
      expect(response.status).toBe(404);
      expect(pluginsKV.reads).toEqual([]);
    },
  );

  it("returns 404 for a missing archive", async () => {
    const { response } = await requestApp("/claude/plugins/archives/missing.zip", {
      origin: null,
      session: USER,
      headers: desktopHeaders(),
      plans: [entitledPlan()],
    });
    expect(response.status).toBe(404);
  });
});

describe("Claude Desktop plugin marketplace publishing", () => {
  it.each([
    ["missing", {}],
    ["wrong", { Authorization: "Bearer wrong-token-wrong-token-123456" }],
  ])("returns 401 for %s publish token", async (_label, headers) => {
    const { response } = await requestApp("/claude/plugins/_publish/archives/example.zip", {
      method: "PUT",
      rawBody: ZIP_BYTES,
      origin: null,
      headers,
      env: { MARKETPLACE_PUBLISH_TOKEN: PUBLISH_TOKEN },
    });
    expect(response.status).toBe(401);
  });

  it("returns 503 when the publish secret is unset or too short", async () => {
    const { response } = await requestApp("/claude/plugins/_publish/archives/example.zip", {
      method: "PUT",
      rawBody: ZIP_BYTES,
      origin: null,
      headers: { Authorization: "Bearer short" },
      env: { MARKETPLACE_PUBLISH_TOKEN: "short" },
    });
    expect(response.status).toBe(503);
  });

  it.each([
    ["archive", "/claude/plugins/_publish/archives/example.zip", ZIP_BYTES.buffer, publishHeaders("0".repeat(64))],
    ["manifest", "/claude/plugins/_publish/manifest", "{}", publishHeaders()],
  ])("returns 411 for a %s upload without Content-Length", async (_label, path, rawBody, headers) => {
    const { response } = await requestApp(path, {
      method: "PUT",
      rawBody,
      origin: null,
      headers,
      env: { MARKETPLACE_PUBLISH_TOKEN: PUBLISH_TOKEN },
    });
    expect(response.status).toBe(411);
  });

  it.each(["0", "abc", "1.5", "+7"])(
    "returns 400 for malformed Content-Length %s",
    async (contentLength) => {
      const { response } = await requestApp("/claude/plugins/_publish/archives/example.zip", {
        method: "PUT",
        rawBody: ZIP_BYTES.buffer,
        origin: null,
        headers: publishHeaders(await sha256Hex(ZIP_BYTES.buffer), contentLength),
        env: { MARKETPLACE_PUBLISH_TOKEN: PUBLISH_TOKEN },
      });
      expect(response.status).toBe(400);
    },
  );

  it.each([
    ["archive", "/claude/plugins/_publish/archives/example.zip", 24 * 1024 * 1024 + 1, publishHeaders("0".repeat(64), 24 * 1024 * 1024 + 1)],
    ["manifest", "/claude/plugins/_publish/manifest", 1024 * 1024 + 1, publishHeaders(undefined, 1024 * 1024 + 1)],
  ])("returns 413 for a %s Content-Length over its cap", async (_label, path, _length, headers) => {
    const { response } = await requestApp(path, {
      method: "PUT",
      rawBody: "x",
      origin: null,
      headers,
      env: { MARKETPLACE_PUBLISH_TOKEN: PUBLISH_TOKEN },
    });
    expect(response.status).toBe(413);
  });

  it.each([
    ["archive", "/claude/plugins/_publish/archives/example.zip", ZIP_BYTES.buffer, ZIP_BYTES.byteLength + 1],
    ["manifest", "/claude/plugins/_publish/manifest", "{}", 3],
  ])("returns 400 when %s body length differs from Content-Length", async (label, path, rawBody, contentLength) => {
    const headers = label === "archive"
      ? publishHeaders(await sha256Hex(ZIP_BYTES.buffer), contentLength)
      : publishHeaders(undefined, contentLength);
    const { response } = await requestApp(path, {
      method: "PUT",
      rawBody,
      origin: null,
      headers,
      env: { MARKETPLACE_PUBLISH_TOKEN: PUBLISH_TOKEN },
    });
    expect(response.status).toBe(400);
  });

  it("rejects an archive whose sha256 does not match", async () => {
    const { response } = await requestApp("/claude/plugins/_publish/archives/example.zip", {
      method: "PUT",
      rawBody: ZIP_BYTES,
      origin: null,
      headers: publishHeaders("0".repeat(64), ZIP_BYTES.byteLength),
      env: { MARKETPLACE_PUBLISH_TOKEN: PUBLISH_TOKEN },
    });
    expect(response.status).toBe(422);
  });

  it("rejects a non-ZIP body", async () => {
    const bytes = new TextEncoder().encode("not a zip");
    const { response } = await requestApp("/claude/plugins/_publish/archives/example.zip", {
      method: "PUT",
      rawBody: asArrayBuffer(bytes),
      origin: null,
      headers: publishHeaders(await sha256Hex(asArrayBuffer(bytes)), bytes.byteLength),
      env: { MARKETPLACE_PUBLISH_TOKEN: PUBLISH_TOKEN },
    });
    expect(response.status).toBe(422);
  });

  it("rejects an archive larger than 24 MiB", async () => {
    const bytes = new Uint8Array(24 * 1024 * 1024 + 1);
    bytes.set([0x50, 0x4b, 0x03, 0x04]);
    const { response } = await requestApp("/claude/plugins/_publish/archives/example.zip", {
      method: "PUT",
      rawBody: asArrayBuffer(bytes),
      origin: null,
      headers: publishHeaders(await sha256Hex(asArrayBuffer(bytes)), bytes.byteLength),
      env: { MARKETPLACE_PUBLISH_TOKEN: PUBLISH_TOKEN },
    });
    expect(response.status).toBe(413);
  });

  it("makes archive uploads immutable but idempotent for identical bytes", async () => {
    const pluginsKV = new KVSpy();
    const first = await publishArchive(pluginsKV);
    const second = await publishArchive(pluginsKV);
    const different = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x09]);
    const conflict = await publishArchive(pluginsKV, "example.zip", different);

    expect(first.response.status).toBe(200);
    expect(second.response.status).toBe(200);
    expect(conflict.response.status).toBe(409);
  });

  it.each([
    ["wrong origin url", (manifest: ReturnType<typeof manifestFor>) => { manifest.plugins[0]!.source.url = "https://other.example/claude/plugins/archives/example.zip"; }],
    ["missing archive", (_manifest: ReturnType<typeof manifestFor>) => undefined],
    ["sha mismatch", (manifest: ReturnType<typeof manifestFor>) => { manifest.plugins[0]!.source.sha256 = "0".repeat(64); }],
    ["bad name", (manifest: ReturnType<typeof manifestFor>) => { manifest.plugins[0]!.name = "Bad_Name"; }],
    ["duplicate names", (manifest: ReturnType<typeof manifestFor>) => { manifest.plugins.push({ ...manifest.plugins[0]!, source: { ...manifest.plugins[0]!.source } }); }],
    ["bad installation preference", (manifest: ReturnType<typeof manifestFor>) => { manifest.plugins[0]!.installationPreference = "available"; }],
  ])("rejects manifest validation failure: %s", async (label, mutate) => {
    const pluginsKV = new KVSpy();
    const uploaded = label === "missing archive"
      ? { sha256: await sha256Hex(asArrayBuffer(ZIP_BYTES)) }
      : await publishArchive(pluginsKV);
    const manifest = manifestFor("example.zip", uploaded.sha256);
    mutate(manifest);
    const manifestBytes = JSON.stringify(manifest);
    pluginsKV.reads.length = 0;

    const { response } = await requestApp("/claude/plugins/_publish/manifest", {
      method: "PUT",
      rawBody: manifestBytes,
      origin: null,
      headers: publishHeaders(undefined, new TextEncoder().encode(manifestBytes).byteLength),
      env: { MARKETPLACE_PUBLISH_TOKEN: PUBLISH_TOKEN },
      pluginsKV,
    });

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({ error: "invalid_manifest", reason: expect.any(String) });
    expect(pluginsKV.reads.some(({ type }) => type === "arrayBuffer")).toBe(false);
  });

  it("stores exact current and history manifest bytes on the happy path", async () => {
    const pluginsKV = new KVSpy();
    const { sha256, response: archiveResponse } = await publishArchive(pluginsKV);
    expect(archiveResponse.status).toBe(200);
    const manifestBytes = JSON.stringify(manifestFor("example.zip", sha256), null, 2);
    const manifestSha256 = await sha256Hex(new TextEncoder().encode(manifestBytes));
    pluginsKV.reads.length = 0;

    const { response } = await requestApp("/claude/plugins/_publish/manifest", {
      method: "PUT",
      rawBody: manifestBytes,
      origin: null,
      headers: publishHeaders(undefined, new TextEncoder().encode(manifestBytes).byteLength),
      env: { MARKETPLACE_PUBLISH_TOKEN: PUBLISH_TOKEN },
      pluginsKV,
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, manifestSha256, plugins: 1 });
    expect(await pluginsKV.get("manifest:current", "text")).toBe(manifestBytes);
    expect(await pluginsKV.get(`manifest:${manifestSha256}`, "text")).toBe(manifestBytes);
    expect(pluginsKV.reads.some(({ type }) => type === "arrayBuffer")).toBe(false);
    expect(pluginsKV.reads).toContainEqual({
      key: "archive:example.zip",
      type: "stream",
      withMetadata: true,
    });
  });
});
