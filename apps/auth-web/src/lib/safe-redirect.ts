const TRUSTED_REDIRECT_HOSTS = new Set(
  [
    typeof window === "undefined" ? undefined : window.location.host,
    process.env.NEXT_PUBLIC_CONSOLE_URL,
    "console.auth-dev.vortex.so",
  ]
    .filter((value): value is string => Boolean(value))
    .map((value) => {
      try {
        return new URL(value.includes("://") ? value : `https://${value}`).host;
      } catch {
        return value;
      }
    }),
);

export function safeRedirectTarget(raw: string | null | undefined): string {
  if (!raw) return "/";
  if (raw.startsWith("/") && !raw.startsWith("//")) return raw;
  try {
    const url = new URL(raw);
    if (url.protocol === "https:" && TRUSTED_REDIRECT_HOSTS.has(url.host)) {
      return url.toString();
    }
  } catch {}
  return "/";
}
