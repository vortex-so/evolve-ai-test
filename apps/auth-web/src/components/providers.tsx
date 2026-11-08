"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import NextLink from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useMemo, type ReactNode } from "react";
import { Toaster } from "sonner";

import { AuthProvider } from "@vortex/ui/components/auth/auth-provider";

import { authClient } from "@/lib/auth-client";
import { getQueryClient } from "@/lib/query-client";
import { safeRedirectTarget } from "@/lib/safe-redirect";

function ProvidersInner({ children }: { children: ReactNode }) {
  const queryClient = getQueryClient();
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = useMemo(
    () => safeRedirectTarget(searchParams.get("redirect")),
    [searchParams],
  );

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
        <AuthProvider
          authClient={authClient}
          queryClient={queryClient}
          redirectTo={redirectTo}
          navigate={({ to, replace }) => {
            const isExternal =
              typeof to === "string" &&
              /^https?:\/\//i.test(to) &&
              (typeof window === "undefined" ||
                new URL(to).origin !== window.location.origin);
            if (isExternal) {
              if (replace) window.location.replace(to);
              else window.location.assign(to);
              return;
            }
            if (replace) router.replace(to);
            else router.push(to);
          }}
          Link={NextLink}
        >
          {children}
          <Toaster richColors closeButton />
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export function Providers({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={null}>
      <ProvidersInner>{children}</ProvidersInner>
    </Suspense>
  );
}
