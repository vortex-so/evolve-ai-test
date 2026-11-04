import Link from "next/link";

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-svh max-w-lg flex-col items-center justify-center gap-6 p-6">
      <h1 className="text-2xl font-semibold">Vortex Auth</h1>
      <p className="text-sm text-muted-foreground">
        Single sign-on for Vortex company apps.
      </p>
      <div className="flex gap-3">
        <Link
          href="/auth/sign-in"
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          Sign in
        </Link>
        <Link
          href="/auth/sign-up"
          className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent"
        >
          Create account
        </Link>
      </div>
    </main>
  );
}
