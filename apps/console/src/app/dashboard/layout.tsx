import type { ReactNode } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import type { Session } from "@/lib/admin-bff";
import { getCurrentUrl } from "@/lib/admin-server";
import { DashboardNav } from "@/components/dashboard-nav";
import { SignOutButton } from "@/components/sign-out-button";

export const dynamic = "force-dynamic";

const AUTH_API_URL =
  process.env.NEXT_PUBLIC_AUTH_API_URL ?? "https://api.auth-dev.vortex.so";
const CONSOLE_ORIGIN =
  process.env.NEXT_PUBLIC_CONSOLE_URL ?? "https://console.auth-dev.vortex.so";

type AuthSessionPayload = {
  session?: Record<string, unknown> | null;
  user?: {
    id: string;
    role?: string | null;
    [key: string]: unknown;
  } | null;
};

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

function redirectToSignIn(currentUrl: string): never {
  const url = new URL(
    `${process.env.NEXT_PUBLIC_AUTH_WEB_URL ?? "https://auth.auth-dev.vortex.so"}/auth/sign-in`,
  );
  url.searchParams.set("redirect", currentUrl);
  redirect(url.toString());
}

async function getSessionFromAuthServer(cookieHeader: string): Promise<Session | null> {
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
      return null;
    }

    return normalizeSession((await response.json()) as AuthSessionPayload | null);
  } catch {
    return null;
  }
}

export default async function DashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  const [cookieStore, headerStore] = await Promise.all([cookies(), headers()]);
  const cookieHeader = cookieStore.toString();
  const currentUrl = getCurrentUrl(headerStore);

  if (!cookieHeader) {
    redirectToSignIn(currentUrl);
  }

  const session = await getSessionFromAuthServer(cookieHeader);

  if (!session) {
    redirectToSignIn(currentUrl);
  }

  if (session.user.role !== "admin" || session.impersonatedBy) {
    redirect("/403");
  }

  return (
    <div className="min-h-svh bg-muted/30 text-foreground">
      <div className="mx-auto flex min-h-svh max-w-7xl flex-col lg:flex-row">
        <aside className="border-b border-border bg-background lg:w-72 lg:border-r lg:border-b-0">
          <div className="sticky top-0 flex flex-col gap-6 px-6 py-6">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                Vortex Auth
              </p>
              <h1 className="mt-2 text-lg font-semibold">Admin Console</h1>
            </div>
            <DashboardNav />
          </div>
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="border-b border-border bg-background/90 backdrop-blur">
            <div className="flex items-center justify-between gap-4 px-6 py-4">
              <div>
                <p className="text-sm text-muted-foreground">Signed in as</p>
                <p className="text-sm font-medium">{String(session.user.email ?? session.user.id)}</p>
              </div>
              <SignOutButton />
            </div>
          </header>
          <main className="flex-1 px-6 py-8">{children}</main>
        </div>
      </div>
    </div>
  );
}
