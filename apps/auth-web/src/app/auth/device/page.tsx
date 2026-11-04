"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { Alert, AlertDescription } from "@vortex/ui/components/alert";
import { Button } from "@vortex/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@vortex/ui/components/card";
import { Input } from "@vortex/ui/components/input";
import { Label } from "@vortex/ui/components/label";

import { authClient } from "@/lib/auth-client";

type Verification =
  | { status: "loading" }
  | { status: "no_code" }
  | { status: "expired" }
  | { status: "invalid" }
  | { status: "already_used" }
  | { status: "valid"; userCode: string }
  | { status: "approved" }
  | { status: "denied" };

export default function DevicePage() {
  const router = useRouter();
  const params = useSearchParams();
  const userCodeParam = params.get("user_code");
  const outcome = params.get("outcome");
  const [state, setState] = useState<Verification>({ status: "loading" });
  const [manualCode, setManualCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function verify() {
      const session = await authClient.getSession();
      if (session.error || !session.data) {
        const back = encodeURIComponent(
          `/auth/device${userCodeParam ? `?user_code=${userCodeParam}` : ""}`,
        );
        router.replace(`/auth/sign-in?redirect=${back}`);
        return;
      }
      if (outcome === "approved") {
        setState({ status: "approved" });
        return;
      }
      if (outcome === "denied") {
        setState({ status: "denied" });
        return;
      }
      if (!userCodeParam) {
        setState({ status: "no_code" });
        return;
      }
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_AUTH_API_URL ?? "https://api.auth-dev.vortex.so"}/api/auth/device?user_code=${encodeURIComponent(userCodeParam)}`,
        { credentials: "include" },
      );
      if (cancelled) return;
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        if (body.error === "expired_token") setState({ status: "expired" });
        else setState({ status: "invalid" });
        return;
      }
      const data = (await res.json()) as { status: string };
      if (data?.status === "approved" || data?.status === "denied") {
        setState({ status: "already_used" });
        return;
      }
      setState({ status: "valid", userCode: userCodeParam });
    }
    verify();
    return () => {
      cancelled = true;
    };
  }, [userCodeParam, outcome, router]);

  async function respond(action: "approve" | "deny") {
    if (state.status !== "valid") return;
    setBusy(true);
    setError(null);
    const call =
      action === "approve"
        ? authClient.device.approve({ userCode: state.userCode })
        : authClient.device.deny({ userCode: state.userCode });
    const res = await call;
    setBusy(false);
    if (res.error) {
      const err = res.error as { message?: string; error_description?: string };
      setError(err.message ?? err.error_description ?? `Could not ${action}`);
      return;
    }
    router.replace(
      `/auth/device?user_code=${state.userCode}&outcome=${action}d`,
    );
  }

  const Shell = ({
    title,
    description,
    children,
  }: {
    title: string;
    description?: string;
    children?: React.ReactNode;
  }) => (
    <main className="mx-auto flex min-h-svh max-w-md flex-col items-center justify-center p-6">
      <Card className="w-full">
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </CardHeader>
        {children && <CardContent>{children}</CardContent>}
      </Card>
    </main>
  );

  if (state.status === "loading") return <Shell title="Loading…" />;
  if (state.status === "approved")
    return (
      <Shell
        title="Approved"
        description="Return to the app that requested sign-in."
      >
        <p className="text-sm text-muted-foreground">You may close this tab.</p>
      </Shell>
    );
  if (state.status === "denied")
    return (
      <Shell title="Sign-in canceled">
        <p className="text-sm text-muted-foreground">You may close this tab.</p>
      </Shell>
    );
  if (state.status === "expired")
    return (
      <Shell title="Code expired" description="Restart sign-in from the app." />
    );
  if (state.status === "already_used")
    return (
      <Shell title="Code already used">
        <p className="text-sm text-muted-foreground">Nothing else to do.</p>
      </Shell>
    );

  if (state.status === "no_code" || state.status === "invalid") {
    return (
      <Shell
        title="Enter the code"
        description="Type the code shown in the app you're signing in from."
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!manualCode) return;
            router.push(
              `/auth/device?user_code=${encodeURIComponent(manualCode.trim())}`,
            );
          }}
          className="flex flex-col gap-4"
        >
          {state.status === "invalid" && (
            <Alert variant="destructive">
              <AlertDescription>
                That code isn&apos;t valid. Double-check the letters and dashes.
              </AlertDescription>
            </Alert>
          )}
          <div className="flex flex-col gap-2">
            <Label htmlFor="code">Code</Label>
            <Input
              id="code"
              name="code"
              type="text"
              pattern="[A-Z0-9\-]+"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              required
              autoFocus
              value={manualCode}
              onChange={(e) => setManualCode(e.target.value.toUpperCase())}
            />
          </div>
          <Button type="submit" className="w-full">
            Continue
          </Button>
        </form>
      </Shell>
    );
  }

  return (
    <Shell
      title="Approve sign-in?"
      description="Confirm this code matches the one shown in the app."
    >
      <div className="flex flex-col gap-4">
        <div className="rounded-md border bg-muted p-4 text-center font-mono text-2xl tracking-widest">
          {state.userCode}
        </div>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => respond("deny")}
          >
            Deny
          </Button>
          <Button
            disabled={busy}
            onClick={() => respond("approve")}
            className="bg-green-600 text-white hover:bg-green-700"
          >
            {busy ? "…" : "Approve"}
          </Button>
        </div>
      </div>
    </Shell>
  );
}
