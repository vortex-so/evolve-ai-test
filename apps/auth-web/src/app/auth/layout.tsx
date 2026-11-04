import { Suspense, type ReactNode } from "react";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense
      fallback={
        <main className="mx-auto flex min-h-svh max-w-md flex-col items-center justify-center gap-6 p-6">
          <div className="text-sm text-muted-foreground">Loading…</div>
        </main>
      }
    >
      {children}
    </Suspense>
  );
}
