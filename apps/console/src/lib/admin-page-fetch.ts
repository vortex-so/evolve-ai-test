import { cookies, headers } from "next/headers";

import { fetchJson } from "@/lib/fetch-json";

function getRequestOrigin(headerStore: Headers): string {
  const proto = headerStore.get("x-forwarded-proto") ?? "https";
  const host =
    headerStore.get("x-forwarded-host") ??
    headerStore.get("host") ??
    "console.auth-dev.vortex.so";

  return `${proto}://${host}`;
}

export async function fetchAdminPageJson<T>(path: string): Promise<T> {
  const [cookieStore, headerStore] = await Promise.all([cookies(), headers()]);
  const origin = getRequestOrigin(headerStore);

  return fetchJson<T>(new URL(path, origin), {
    headers: {
      cookie: cookieStore.toString(),
      origin,
    },
    cache: "no-store",
  });
}
