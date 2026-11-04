export default function ForbiddenPage() {
  return (
    <main className="mx-auto flex min-h-svh max-w-3xl flex-col justify-center px-6 py-16">
      <p className="text-sm font-medium uppercase tracking-[0.2em] text-muted-foreground">
        Access denied
      </p>
      <h1 className="mt-4 text-3xl font-semibold">403</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        This console page requires a non-impersonated admin session.
      </p>
    </main>
  );
}
