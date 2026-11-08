import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

const SESSION_COOKIE_NAMES = [
  "__Secure-better-auth.session_token",
  "better-auth.session_token",
];

function hasSessionCookie(req: NextRequest): boolean {
  return SESSION_COOKIE_NAMES.some((name) => req.cookies.has(name));
}

function buildSignInRedirect(req: NextRequest): URL {
  const url = new URL(
    `${process.env.NEXT_PUBLIC_AUTH_WEB_URL ?? "https://auth.auth-dev.vortex.so"}/auth/sign-in`,
  );
  url.searchParams.set("redirect", req.nextUrl.href);
  return url;
}

export function middleware(req: NextRequest): NextResponse {
  if (!hasSessionCookie(req)) {
    if (req.nextUrl.pathname.startsWith("/api/admin/")) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }

    if (req.nextUrl.pathname.startsWith("/dashboard")) {
      return NextResponse.redirect(buildSignInRedirect(req));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/api/admin/:path*", "/dashboard/:path*"],
};
