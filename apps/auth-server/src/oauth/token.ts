import type { createRefreshTokenService } from "../lib/refresh-token";

const DEVICE_CODE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";
const DEFAULT_CLIENT_ID = "claude-desktop";

type RefreshTokenService = ReturnType<typeof createRefreshTokenService>;

export type OAuthRefreshService = Pick<
  RefreshTokenService,
  "issueForAccessToken" | "refresh"
>;

type OAuthBody = Record<string, string>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function parseOAuthBody(request: Request): Promise<OAuthBody> {
  const body: OAuthBody = {};
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/x-www-form-urlencoded")) {
    const form = await request.formData().catch(() => null);
    if (form) {
      for (const [key, value] of form) body[key] = String(value);
    }
    return body;
  }

  const text = await request.text();
  if (!text) return body;
  try {
    const parsed: unknown = JSON.parse(text);
    if (!isRecord(parsed)) return body;
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "string") body[key] = value;
    }
  } catch {
    return body;
  }
  return body;
}

function jsonTokenResponse(body: unknown, status: number, sourceHeaders?: Headers): Response {
  const headers = new Headers(sourceHeaders);
  headers.delete("content-length");
  headers.delete("content-encoding");
  headers.delete("set-cookie");
  headers.set("content-type", "application/json");
  headers.set("cache-control", "no-store");
  headers.set("pragma", "no-cache");
  return new Response(JSON.stringify(body), { status, headers });
}

function betterAuthTokenRequest(request: Request, body: OAuthBody): Request {
  const url = new URL(request.url);
  url.pathname = "/api/auth/device/token";
  const headers = new Headers(request.headers);
  headers.set("content-type", "application/json");
  headers.delete("content-length");
  return new Request(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

export function createOAuthTokenHandler(deps: {
  authHandler(request: Request): Promise<Response>;
  refreshService: OAuthRefreshService;
}) {
  return async function oauthTokenHandler(request: Request): Promise<Response> {
    const body = await parseOAuthBody(request);
    const grantType = body.grant_type;
    if (!grantType) return jsonTokenResponse({ error: "invalid_request" }, 400);

    const clientId = body.client_id || DEFAULT_CLIENT_ID;
    if (grantType === "refresh_token") {
      const result = await deps.refreshService.refresh({
        refreshToken: body.refresh_token,
        clientId,
      });
      return result.ok
        ? jsonTokenResponse(result.body, 200)
        : jsonTokenResponse({ error: result.error }, 400);
    }

    if (grantType !== DEVICE_CODE_GRANT) {
      return jsonTokenResponse({ error: "unsupported_grant_type" }, 400);
    }

    body.client_id = clientId;
    const authResponse = await deps.authHandler(betterAuthTokenRequest(request, body));
    const responseText = await authResponse.text();
    let responseBody: unknown;
    try {
      responseBody = JSON.parse(responseText);
    } catch {
      return jsonTokenResponse({ error: "server_error" }, 502);
    }

    if (authResponse.status === 200 && isRecord(responseBody)) {
      const accessToken = responseBody.access_token;
      if (typeof accessToken === "string") {
        const scope =
          typeof responseBody.scope === "string"
            ? responseBody.scope
            : body.scope;
        const issued = await deps.refreshService.issueForAccessToken({
          accessToken,
          clientId,
          scope,
        });
        if (issued) {
          responseBody.refresh_token = issued.refreshToken;
          responseBody.refresh_token_expires_in = issued.expiresIn;
        }
      }
    }

    return jsonTokenResponse(responseBody, authResponse.status, authResponse.headers);
  };
}
