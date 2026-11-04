import { cookies, headers } from "next/headers";

type AdminFetchError = {
  status: number;
  code?: string;
  message: string;
  details?: unknown;
};

function getOriginFromHeaders(headerStore: Headers): string {
  const host =
    headerStore.get("x-forwarded-host") ??
    headerStore.get("host") ??
    "console.auth-dev.vortex.so";
  const proto =
    headerStore.get("x-forwarded-proto") ??
    (host.startsWith("localhost") ? "http" : "https");

  return `${proto}://${host}`;
}

export async function fetchAdminJson<T>(path: string): Promise<T> {
  const [cookieStore, headerStore] = await Promise.all([cookies(), headers()]);
  const origin = getOriginFromHeaders(headerStore);

  const response = await fetch(`${origin}${path}`, {
    method: "GET",
    headers: {
      cookie: cookieStore.toString(),
      origin,
    },
    cache: "no-store",
  });

  if (!response.ok) {
    let payload: Record<string, unknown> | null = null;

    try {
      payload = (await response.json()) as Record<string, unknown>;
    } catch {
      payload = null;
    }

    const error: AdminFetchError = {
      status: response.status,
      code:
        typeof payload?.code === "string"
          ? payload.code
          : typeof payload?.error === "string"
            ? payload.error
            : undefined,
      message:
        typeof payload?.message === "string"
          ? payload.message
          : typeof payload?.error === "string"
            ? payload.error
            : `Request failed with status ${response.status}`,
      details: payload,
    };

    throw error;
  }

  return (await response.json()) as T;
}
