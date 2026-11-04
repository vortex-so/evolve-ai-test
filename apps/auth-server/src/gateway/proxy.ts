const REQUEST_HEADERS_TO_FORWARD = new Set([
  "content-type",
  "accept",
  "user-agent",
  "x-app",
]);

const REQUEST_HEADER_PREFIXES_TO_FORWARD = [
  "anthropic-",
  "x-stainless-",
  "x-claude-code-",
];

const RESPONSE_HEADERS_TO_REMOVE = new Set([
  "content-length",
  "content-encoding",
  "transfer-encoding",
  "connection",
  "set-cookie",
]);

type ProxyResult =
  | { kind: "response"; response: Response }
  | { kind: "unauthorized" }
  | { kind: "network_error" };

type McpProxyResult =
  | { kind: "response"; response: Response }
  | { kind: "rejected"; status: 401 | 403 }
  | { kind: "network_error" };

const MCP_REQUEST_HEADERS_TO_FORWARD = new Set([
  "content-type",
  "accept",
  "mcp-session-id",
  "mcp-protocol-version",
  "last-event-id",
  "user-agent",
]);

const MCP_RESPONSE_HEADERS_TO_FORWARD = new Set([
  "content-type",
  "mcp-session-id",
]);

function shouldForwardRequestHeader(name: string): boolean {
  return (
    REQUEST_HEADERS_TO_FORWARD.has(name) ||
    REQUEST_HEADER_PREFIXES_TO_FORWARD.some((prefix) => name.startsWith(prefix))
  );
}

function proxyRequestHeaders(request: Request, userKey: string): Headers {
  const headers = new Headers();
  request.headers.forEach((value, name) => {
    const normalized = name.toLowerCase();
    if (shouldForwardRequestHeader(normalized)) headers.append(name, value);
  });
  headers.set("authorization", `Bearer ${userKey}`);
  return headers;
}

function proxyResponseHeaders(response: Response): Headers {
  const headers = new Headers();
  response.headers.forEach((value, name) => {
    if (!RESPONSE_HEADERS_TO_REMOVE.has(name.toLowerCase())) headers.append(name, value);
  });
  if (!headers.has("cache-control")) headers.set("cache-control", "no-store");
  return headers;
}

function apiError(message: string, status: number, retryable = false): Response {
  const headers = new Headers({
    "content-type": "application/json",
    "cache-control": "no-store",
  });
  if (retryable) headers.set("x-should-retry", "true");
  return new Response(
    JSON.stringify({ type: "error", error: { type: "api_error", message } }),
    { status, headers },
  );
}

function parseBudgetError(body: Uint8Array): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(body));
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || !("error" in parsed)) return null;
  const error = parsed.error;
  if (typeof error !== "object" || error === null) return null;
  const type = "type" in error && typeof error.type === "string" ? error.type : "";
  const message = "message" in error && typeof error.message === "string" ? error.message : "";
  const normalizedMessage = message.toLowerCase();
  const isBudgetExceeded =
    type === "budget_exceeded" ||
    (normalizedMessage.includes("budget") && normalizedMessage.includes("exceed"));
  return isBudgetExceeded ? message || "Inference budget exceeded" : null;
}

export async function proxyInferenceRequest(input: {
  request: Request;
  baseUrl: string;
  userKey: string;
  fetch?: typeof fetch;
}): Promise<ProxyResult> {
  const requestUrl = new URL(input.request.url);
  const upstreamUrl = `${input.baseUrl.replace(/\/+$/, "")}${requestUrl.pathname}${requestUrl.search}`;
  const hasBody = input.request.method !== "GET" && input.request.method !== "HEAD";
  const init: RequestInit & { duplex?: "half" } = {
    method: input.request.method,
    headers: proxyRequestHeaders(input.request, input.userKey),
    body: hasBody ? input.request.body : null,
    redirect: "manual",
  };
  if (hasBody) init.duplex = "half";

  let upstream: Response;
  try {
    upstream = await (input.fetch ?? fetch)(upstreamUrl, init);
  } catch {
    return { kind: "network_error" };
  }

  if (upstream.status === 401) {
    await upstream.arrayBuffer();
    return { kind: "unauthorized" };
  }

  const headers = proxyResponseHeaders(upstream);
  if (upstream.status === 429) {
    const bytes = new Uint8Array(await upstream.arrayBuffer());
    const budgetMessage = parseBudgetError(bytes);
    if (budgetMessage) {
      return {
        kind: "response",
        response: new Response(
          JSON.stringify({
            type: "error",
            error: { type: "billing_error", message: budgetMessage },
          }),
          {
            status: 402,
            headers: {
              "content-type": "application/json",
              "cache-control": "no-store",
            },
          },
        ),
      };
    }
    return {
      kind: "response",
      response: new Response(bytes, { status: upstream.status, headers }),
    };
  }

  return {
    kind: "response",
    response: new Response(upstream.body, { status: upstream.status, headers }),
  };
}

export async function proxyMcpRequest(input: {
  request: Request;
  baseUrl: string;
  server: string;
  userKey: string;
  fetch?: typeof fetch;
}): Promise<McpProxyResult> {
  const requestUrl = new URL(input.request.url);
  const upstreamUrl = `${input.baseUrl.replace(/\/+$/, "")}/${input.server}/mcp${requestUrl.search}`;
  const headers = new Headers();
  input.request.headers.forEach((value, name) => {
    if (MCP_REQUEST_HEADERS_TO_FORWARD.has(name.toLowerCase())) headers.append(name, value);
  });
  headers.set("x-litellm-api-key", `Bearer ${input.userKey}`);

  const hasBody = input.request.method !== "GET" && input.request.method !== "HEAD";
  const init: RequestInit & { duplex?: "half" } = {
    method: input.request.method,
    headers,
    body: hasBody ? input.request.body : null,
    redirect: "manual",
  };
  if (hasBody) init.duplex = "half";

  let upstream: Response;
  try {
    upstream = await (input.fetch ?? fetch)(upstreamUrl, init);
  } catch {
    return { kind: "network_error" };
  }

  if (upstream.status === 401 || upstream.status === 403) {
    await upstream.arrayBuffer();
    return { kind: "rejected", status: upstream.status };
  }

  const responseHeaders = new Headers();
  upstream.headers.forEach((value, name) => {
    if (MCP_RESPONSE_HEADERS_TO_FORWARD.has(name.toLowerCase())) {
      responseHeaders.append(name, value);
    }
  });
  responseHeaders.set("cache-control", "no-store");
  return {
    kind: "response",
    response: new Response(upstream.body, {
      status: upstream.status,
      headers: responseHeaders,
    }),
  };
}

export function mcpErrorResponse(error: string, status: number): Response {
  const headers = new Headers({
    "content-type": "application/json",
    "cache-control": "no-store",
  });
  if (status === 401) headers.set("www-authenticate", "Bearer");
  return new Response(JSON.stringify({ error }), { status, headers });
}

export function provisioningFailureResponse(): Response {
  return apiError("Could not provision an inference key", 502, true);
}

export function upstreamKeyRejectedResponse(): Response {
  return apiError("Upstream rejected the inference key; retry", 502, true);
}

export function upstreamNetworkErrorResponse(): Response {
  return apiError("Could not reach the inference service", 502, true);
}
