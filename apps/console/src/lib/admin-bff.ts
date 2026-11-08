const AUTH_API_URL =
  process.env.NEXT_PUBLIC_AUTH_API_URL ?? "https://api.auth-dev.vortex.so";

const CONSOLE_ORIGIN =
  process.env.NEXT_PUBLIC_CONSOLE_URL ?? "https://console.auth-dev.vortex.so";
const LOCAL_CONSOLE_ORIGIN = "http://localhost:3001";

type AuthSessionPayload = {
  session?: Record<string, unknown> | null;
  user?: {
    id: string;
    role?: string | null;
    [key: string]: unknown;
  } | null;
};

export type Session = Record<string, unknown> & {
  user: {
    id: string;
    role?: string | null;
    [key: string]: unknown;
  };
  impersonatedBy?: unknown;
};

type ProxyRequestOptions = {
  req: Request;
  cookieHeader: string;
  method?: string;
  body?: BodyInit | null;
  headers?: HeadersInit;
};

function jsonResponse(error: string, status: number): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: {
      "content-type": "application/json",
    },
  });
}

function normalizeSession(payload: AuthSessionPayload | null): Session | null {
  if (!payload?.session || !payload.user) {
    return null;
  }

  return {
    ...payload.session,
    user: payload.user,
    impersonatedBy: payload.session.impersonatedBy,
  };
}

function copyProxyHeaders(req: Request, headersInit?: HeadersInit): Headers {
  const headers = new Headers();

  for (const [key, value] of req.headers) {
    const normalized = key.toLowerCase();

    if (
      normalized === "cookie" ||
      normalized === "origin" ||
      normalized === "host" ||
      normalized === "content-length"
    ) {
      continue;
    }

    headers.set(key, value);
  }

  if (headersInit) {
    const extraHeaders = new Headers(headersInit);
    for (const [key, value] of extraHeaders) {
      headers.set(key, value);
    }
  }

  return headers;
}

export function withSearch(path: string, searchParams: URLSearchParams): string {
  const query = searchParams.toString();
  return query ? `${path}?${query}` : path;
}

export async function readJsonBody(req: Request): Promise<Record<string, unknown>> {
  const text = await req.text();

  if (!text) {
    return {};
  }

  return JSON.parse(text) as Record<string, unknown>;
}

function isTrustedOrigin(value: string | null): boolean {
  return value === CONSOLE_ORIGIN || value === LOCAL_CONSOLE_ORIGIN;
}

function isTrustedReferer(value: string | null): boolean {
  if (!value) return false;
  try {
    return isTrustedOrigin(new URL(value).origin);
  } catch {
    return false;
  }
}

export async function requireAdminSession(
  req: Request,
): Promise<{ session: Session; cookieHeader: string } | Response> {
  const cookieHeader = req.headers.get("cookie") ?? "";

  if (!cookieHeader) {
    return jsonResponse("unauthenticated", 401);
  }

  // Browsers omit Origin on same-origin GET requests; fall back to Referer.
  // Non-browser callers must present a trusted Origin header explicitly.
  const origin = req.headers.get("origin");
  const referer = req.headers.get("referer");
  if (origin !== null) {
    if (!isTrustedOrigin(origin)) {
      return jsonResponse("origin_mismatch", 403);
    }
  } else if (!isTrustedReferer(referer)) {
    return jsonResponse("origin_mismatch", 403);
  }

  try {
    const response = await fetch(`${AUTH_API_URL}/api/auth/get-session`, {
      method: "GET",
      headers: {
        cookie: cookieHeader,
        origin: CONSOLE_ORIGIN,
      },
      credentials: "include",
      cache: "no-store",
    });

    if (!response.ok) {
      return jsonResponse("unauthenticated", 401);
    }

    const payload = (await response.json()) as AuthSessionPayload | null;
    const session = normalizeSession(payload);

    if (!session || session.user.role !== "admin") {
      return jsonResponse("unauthenticated", 401);
    }

    if (session.impersonatedBy) {
      return jsonResponse("impersonated_admin_action_blocked", 403);
    }

    return { session, cookieHeader };
  } catch {
    return jsonResponse("auth_server_unreachable", 502);
  }
}

export async function proxyToAuthServer(
  path: string,
  init: RequestInit & { cookieHeader: string },
): Promise<Response> {
  const { cookieHeader, ...requestInit } = init;

  try {
    const headers = new Headers(requestInit.headers);
    headers.set("cookie", cookieHeader);
    headers.set("origin", CONSOLE_ORIGIN);

    const upstream = await fetch(`${AUTH_API_URL}${path}`, {
      ...requestInit,
      headers,
      credentials: "include",
      cache: "no-store",
    });

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: new Headers(upstream.headers),
    });
  } catch {
    return jsonResponse("auth_server_unreachable", 502);
  }
}

export async function proxyRequestToAuthServer(
  path: string,
  options: ProxyRequestOptions,
): Promise<Response> {
  const headers = copyProxyHeaders(options.req, options.headers);

  return proxyToAuthServer(path, {
    cookieHeader: options.cookieHeader,
    method: options.method ?? options.req.method,
    headers,
    body: options.body,
  });
}

export async function proxyJsonToAuthServer(
  path: string,
  options: Omit<ProxyRequestOptions, "body" | "headers"> & {
    body: Record<string, unknown>;
    method?: string;
  },
): Promise<Response> {
  return proxyRequestToAuthServer(path, {
    ...options,
    method: options.method ?? "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(options.body),
  });
}
