"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@vortex/ui/components/alert";
import { Button } from "@vortex/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@vortex/ui/components/card";

import { authClient } from "@/lib/auth-client";

const SCOPE_LABELS: Record<string, string> = {
  openid: "Confirm your identity",
  profile: "Read your basic profile (name, avatar)",
  email: "Read your email address",
  offline_access: "Stay signed in when you're away",
  "bootstrap:read": "Read your Claude Desktop configuration",
};

type Client = { client_name?: string; client_uri?: string; logo_uri?: string };

export default function OAuthConsentPage() {
  const router = useRouter();
  const params = useSearchParams();
  const clientId = params.get("client_id");
  const scope = params.get("scope") ?? "";
  const oauthQuery = params.toString();
  const [client, setClient] = useState<Client | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const session = await authClient.getSession();
      if (session.error || !session.data) {
        const back = encodeURIComponent(
          `/auth/oauth-consent?${params.toString()}`,
        );
        router.replace(`/auth/sign-in?redirect=${back}`);
        return;
      }
      if (!clientId) {
        setError("Missing client_id");
        return;
      }
      const res = await authClient.oauth2.publicClient({
        query: { client_id: clientId },
      });
      if (res.error) {
        setError(res.error.message ?? "Unknown client");
        return;
      }
      setClient(res.data as Client);
    })();
  }, [clientId, params, router]);

  async function decide(accept: boolean) {
    setBusy(true);
    setError(null);
    const res = await authClient.oauth2.consent({
      accept,
      oauth_query: oauthQuery,
    });
    setBusy(false);
    if (res.error) {
      setError(res.error.message ?? "Consent failed");
      return;
    }
    const body = res.data as
      | { redirect?: boolean; url?: string; redirect_uri?: string }
      | null;
    const url = body?.url ?? body?.redirect_uri;
    if (url) {
      window.location.href = url;
      return;
    }
    toast.success(accept ? "Approved" : "Denied");
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

  if (!client) {
    return (
      <Shell title={error ? "Cannot show consent" : "Loading…"}>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
      </Shell>
    );
  }

  const label = client.client_name ?? clientId ?? "an application";
  const scopes = scope.split(/\s+/).filter(Boolean);
  return (
    <Shell
      title={`Authorize ${label}`}
      description="Review the permissions before approving."
    >
      <div className="flex flex-col gap-4">
        {client.client_uri && (
          <div className="text-xs text-muted-foreground">
            <a
              href={client.client_uri}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:underline"
            >
              {client.client_uri}
            </a>
          </div>
        )}
        <div>
          <div className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Permissions
          </div>
          <ul className="space-y-1.5 text-sm">
            {scopes.map((s) => (
              <li key={s} className="flex items-start gap-2">
                <span className="mt-0.5 text-green-600">✓</span>
                <span>{SCOPE_LABELS[s] ?? s}</span>
              </li>
            ))}
          </ul>
        </div>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" disabled={busy} onClick={() => decide(false)}>
            Deny
          </Button>
          <Button disabled={busy} onClick={() => decide(true)}>
            {busy ? "…" : "Approve"}
          </Button>
        </div>
      </div>
    </Shell>
  );
}
