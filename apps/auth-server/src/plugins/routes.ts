import { Hono, type Context } from "hono";
import type { AdminApp } from "../lib/admin-guard";
import { authenticateBearerSession } from "../lib/bearer-session";
import { isEntitled } from "../lib/entitlement";

const MARKETPLACE_NAME = "vortex-marketplace";
const ARCHIVE_MAX_BYTES = 24 * 1024 * 1024;
const MANIFEST_MAX_BYTES = 1024 * 1024;
const ARCHIVE_FILE_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}\.zip$/;
const PLUGIN_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/i;

type MarketplaceContext = Context<AdminApp>;
type ArchiveMetadata = {
  sha256: string;
  size: number;
  uploadedAt: string;
};

function jsonError(error: string, status: number, reason?: string): Response {
  return new Response(JSON.stringify({ error, ...(reason ? { reason } : {}) }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function invalidToken(): Response {
  return new Response(JSON.stringify({ error: "invalid_token" }), {
    status: 401,
    headers: {
      "content-type": "application/json",
      "www-authenticate": "Bearer",
    },
  });
}

async function requireEntitledBearer(c: MarketplaceContext) {
  const session = await authenticateBearerSession(c);
  if (!session) return { response: invalidToken(), session: null };
  if (!(await isEntitled(c.env.DB, session.user.id))) {
    return { response: jsonError("not_entitled", 403), session: null };
  }
  return { response: null, session };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function parseBearerToken(authorization: string | undefined): string {
  const match = authorization?.match(/^Bearer\s+(\S+)$/i);
  return match?.[1] ?? "";
}

async function hmacDigest(keyBytes: Uint8Array, value: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return new Uint8Array(signature);
}

async function constantTimeTokenMatches(expected: string, supplied: string): Promise<boolean> {
  const comparisonKey = crypto.getRandomValues(new Uint8Array(32));
  const [expectedDigest, suppliedDigest] = await Promise.all([
    hmacDigest(comparisonKey, expected),
    hmacDigest(comparisonKey, supplied),
  ]);
  let difference = expectedDigest.length ^ suppliedDigest.length;
  for (let index = 0; index < expectedDigest.length; index += 1) {
    difference |= expectedDigest[index]! ^ suppliedDigest[index]!;
  }
  return difference === 0;
}

async function requirePublishToken(c: MarketplaceContext): Promise<Response | null> {
  const expected = c.env.MARKETPLACE_PUBLISH_TOKEN?.trim() ?? "";
  if (expected.length < 32) return jsonError("publisher_unavailable", 503);
  const supplied = parseBearerToken(c.req.header("authorization"));
  return await constantTimeTokenMatches(expected, supplied) ? null : invalidToken();
}

function requireContentLength(
  c: MarketplaceContext,
  maximum: number,
): { value: number; response: null } | { value: null; response: Response } {
  const raw = c.req.header("content-length");
  if (raw === undefined) {
    return { value: null, response: jsonError("length_required", 411) };
  }
  if (!/^\d+$/.test(raw)) {
    return { value: null, response: jsonError("invalid_content_length", 400) };
  }
  const parsed = Number(raw);
  if (parsed > maximum) {
    return { value: null, response: jsonError("payload_too_large", 413) };
  }
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    return { value: null, response: jsonError("invalid_content_length", 400) };
  }
  return { value: parsed, response: null };
}

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function isZip(bytes: ArrayBuffer): boolean {
  const view = new Uint8Array(bytes);
  return view.length >= 4
    && view[0] === 0x50
    && view[1] === 0x4b
    && view[2] === 0x03
    && view[3] === 0x04;
}

async function serveManifest(c: MarketplaceContext): Promise<Response> {
  const auth = await requireEntitledBearer(c);
  if (auth.response) return auth.response;
  const bytes = await c.env.PLUGINS_KV.get("manifest:current", "arrayBuffer");
  if (!bytes) return jsonError("no_marketplace", 404);
  return new Response(bytes, {
    status: 200,
    headers: {
      "content-type": "application/json",
      "cache-control": "private, no-store",
    },
  });
}

async function serveArchive(c: MarketplaceContext): Promise<Response> {
  const auth = await requireEntitledBearer(c);
  if (auth.response) return auth.response;
  const file = c.req.param("file") ?? "";
  if (!ARCHIVE_FILE_PATTERN.test(file)) return jsonError("not_found", 404);
  const archive = await c.env.PLUGINS_KV.getWithMetadata<ArchiveMetadata>(
    `archive:${file}`,
    "stream",
  );
  if (!archive.value) return jsonError("not_found", 404);
  if (!Number.isSafeInteger(archive.metadata?.size) || (archive.metadata?.size ?? 0) < 1) {
    await archive.value.cancel();
    return jsonError("not_found", 404);
  }
  return new Response(archive.value, {
    status: 200,
    headers: {
      "content-type": "application/zip",
      "cache-control": "private, no-store",
      "content-length": String(archive.metadata!.size),
    },
  });
}

async function publishArchive(c: MarketplaceContext): Promise<Response> {
  const authError = await requirePublishToken(c);
  if (authError) return authError;
  const file = c.req.param("file") ?? "";
  if (!ARCHIVE_FILE_PATTERN.test(file)) return jsonError("not_found", 404);
  const contentLength = requireContentLength(c, ARCHIVE_MAX_BYTES);
  if (contentLength.response) return contentLength.response;

  const expectedSha256 = c.req.header("x-content-sha256")?.trim() ?? "";
  if (!SHA256_PATTERN.test(expectedSha256)) {
    return jsonError("invalid_archive", 422, "x-content-sha256 must be 64 hexadecimal characters");
  }

  const bytes = await c.req.arrayBuffer();
  if (bytes.byteLength !== contentLength.value) {
    return jsonError("invalid_content_length", 400);
  }
  const sha256 = await sha256Hex(bytes);
  if (sha256 !== expectedSha256.toLowerCase()) {
    return jsonError("invalid_archive", 422, "archive sha256 does not match x-content-sha256");
  }
  if (!isZip(bytes)) return jsonError("invalid_archive", 422, "archive must start with a ZIP local file header");

  const key = `archive:${file}`;
  const existing = await c.env.PLUGINS_KV.getWithMetadata<ArchiveMetadata>(key, "stream");
  if (existing.value !== null) {
    await existing.value.cancel();
    if (existing.metadata?.sha256 === sha256) {
      return Response.json({ ok: true, file, sha256, idempotent: true });
    }
    return jsonError("archive_conflict", 409, "archive filenames are immutable");
  }

  const metadata: ArchiveMetadata = {
    sha256,
    size: bytes.byteLength,
    uploadedAt: new Date().toISOString(),
  };
  await c.env.PLUGINS_KV.put(key, bytes, { metadata });
  console.info("plugin_marketplace_archive_published", { file, sha256, size: bytes.byteLength });
  return Response.json({ ok: true, file, sha256 });
}

function validateOptionalTopLevelFields(manifest: Record<string, unknown>): string | null {
  for (const field of ["description", "version", "$schema"] as const) {
    if (field in manifest && typeof manifest[field] !== "string") return `${field} must be a string`;
  }
  if ("metadata" in manifest && asRecord(manifest.metadata) === null) return "metadata must be an object";
  return null;
}

async function validateManifest(
  env: AdminApp["Bindings"],
  value: unknown,
): Promise<{ plugins: number } | { reason: string }> {
  const manifest = asRecord(value);
  if (!manifest) return { reason: "manifest must be a JSON object" };
  if (manifest.name !== MARKETPLACE_NAME) return { reason: `name must be ${MARKETPLACE_NAME}` };
  const owner = asRecord(manifest.owner);
  if (!owner || typeof owner.name !== "string" || owner.name.trim() === "") {
    return { reason: "owner.name must be a non-empty string" };
  }
  const optionalFieldError = validateOptionalTopLevelFields(manifest);
  if (optionalFieldError) return { reason: optionalFieldError };
  if (!Array.isArray(manifest.plugins) || manifest.plugins.length < 1 || manifest.plugins.length > 100) {
    return { reason: "plugins must contain between 1 and 100 entries" };
  }

  const names = new Set<string>();
  const archivePrefix = `${env.PUBLIC_ORIGIN.replace(/\/$/, "")}/claude/plugins/archives/`;
  for (let index = 0; index < manifest.plugins.length; index += 1) {
    const plugin = asRecord(manifest.plugins[index]);
    if (!plugin) return { reason: `plugins[${index}] must be an object` };
    if (typeof plugin.name !== "string" || !PLUGIN_NAME_PATTERN.test(plugin.name)) {
      return { reason: `plugins[${index}].name is invalid` };
    }
    if (names.has(plugin.name)) return { reason: `plugin name ${plugin.name} is duplicated` };
    names.add(plugin.name);
    if ("installationPreference" in plugin && plugin.installationPreference !== "auto_install") {
      return { reason: `plugins[${index}].installationPreference must be auto_install` };
    }

    const source = asRecord(plugin.source);
    if (!source || source.source !== "archive") {
      return { reason: `plugins[${index}].source.source must be archive` };
    }
    if (typeof source.url !== "string" || !source.url.startsWith(archivePrefix)) {
      return { reason: `plugins[${index}].source.url must use the marketplace origin` };
    }
    const file = source.url.slice(archivePrefix.length);
    if (!ARCHIVE_FILE_PATTERN.test(file) || source.url !== `${archivePrefix}${file}`) {
      return { reason: `plugins[${index}].source.url must identify one canonical archive file` };
    }
    if (typeof source.sha256 !== "string" || !SHA256_PATTERN.test(source.sha256)) {
      return { reason: `plugins[${index}].source.sha256 is invalid` };
    }
    const archive = await env.PLUGINS_KV.getWithMetadata<ArchiveMetadata>(`archive:${file}`, "stream");
    if (archive.value === null) return { reason: `archive ${file} has not been published` };
    await archive.value.cancel();
    if (archive.metadata?.sha256 !== source.sha256.toLowerCase()) {
      return { reason: `archive ${file} sha256 does not match published metadata` };
    }
  }

  return { plugins: manifest.plugins.length };
}

async function publishManifest(c: MarketplaceContext): Promise<Response> {
  const authError = await requirePublishToken(c);
  if (authError) return authError;
  const contentLength = requireContentLength(c, MANIFEST_MAX_BYTES);
  if (contentLength.response) return contentLength.response;
  const bytes = await c.req.arrayBuffer();
  if (bytes.byteLength !== contentLength.value) {
    return jsonError("invalid_content_length", 400);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes));
  } catch (error) {
    const reason = error instanceof Error ? error.message : "manifest is not valid JSON";
    return jsonError("invalid_manifest", 422, reason);
  }
  const validation = await validateManifest(c.env, parsed);
  if ("reason" in validation) return jsonError("invalid_manifest", 422, validation.reason);

  const manifestSha256 = await sha256Hex(bytes);
  await Promise.all([
    c.env.PLUGINS_KV.put("manifest:current", bytes),
    c.env.PLUGINS_KV.put(`manifest:${manifestSha256}`, bytes),
  ]);
  console.info("plugin_marketplace_manifest_published", {
    manifestSha256,
    plugins: validation.plugins,
  });
  return Response.json({ ok: true, manifestSha256, plugins: validation.plugins });
}

export function createPluginMarketplaceRoutes() {
  const routes = new Hono<AdminApp>();
  routes.get("/marketplace.json", serveManifest);
  routes.get("/archives/:file", serveArchive);
  routes.put("/_publish/archives/:file", publishArchive);
  routes.put("/_publish/manifest", publishManifest);
  return routes;
}
