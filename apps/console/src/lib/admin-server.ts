import { cookies, headers } from "next/headers";

export const CONSOLE_ORIGIN = "https://console.auth-dev.vortex.so";

export function getRequestOrigin(headerStore: Headers): string {
  const proto = headerStore.get("x-forwarded-proto") ?? "https";
  const host =
    headerStore.get("x-forwarded-host") ??
    headerStore.get("host") ??
    "console.auth-dev.vortex.so";

  return `${proto}://${host}`;
}

export function getCurrentUrl(headerStore: Headers, fallbackPath = "/dashboard"): string {
  const nextUrl = headerStore.get("next-url");
  if (nextUrl) {
    return `${getRequestOrigin(headerStore)}${nextUrl}`;
  }

  const pathname = headerStore.get("x-pathname") ?? fallbackPath;
  const search = headerStore.get("x-search") ?? "";
  return `${getRequestOrigin(headerStore)}${pathname}${search}`;
}

export async function fetchAdminResponse(path: string): Promise<Response> {
  const [cookieStore, headerStore] = await Promise.all([cookies(), headers()]);
  const cookieHeader = cookieStore.toString();
  const origin = getRequestOrigin(headerStore);

  return fetch(new URL(path, origin), {
    method: "GET",
    headers: {
      cookie: cookieHeader,
      origin: CONSOLE_ORIGIN,
    },
    cache: "no-store",
  });
}

export async function fetchAdminJson<T>(path: string): Promise<T> {
  const response = await fetchAdminResponse(path);

  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`);
  }

  return (await response.json()) as T;
}
