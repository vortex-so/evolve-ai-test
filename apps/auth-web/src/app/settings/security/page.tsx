"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@vortex/ui/components/alert";
import { Button } from "@vortex/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@vortex/ui/components/card";
import { Input } from "@vortex/ui/components/input";
import { Label } from "@vortex/ui/components/label";

import { authClient } from "@/lib/auth-client";

type SessionRow = {
  id: string;
  token: string;
  ipAddress?: string | null;
  userAgent?: string | null;
  createdAt?: Date | string;
};

function formatDate(v: Date | string | undefined): string {
  if (!v) return "?";
  const s = typeof v === "string" ? v : v.toISOString();
  return s.slice(0, 10);
}

export default function SecuritySettingsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [twoFaEnabled, setTwoFaEnabled] = useState(false);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const session = await authClient.getSession();
      if (session.error || !session.data) {
        router.replace("/auth/sign-in?redirect=/settings/security");
        return;
      }
      const user = session.data.user as { twoFactorEnabled?: boolean };
      setTwoFaEnabled(!!user.twoFactorEnabled);
      const list = await authClient.listSessions();
      if (list.data) setSessions(list.data as unknown as SessionRow[]);
      setLoading(false);
    })();
  }, [router]);

  async function enable2fa() {
    setError(null);
    if (!password) {
      setError("Enter your password to enable 2FA.");
      return;
    }
    setBusy(true);
    const res = await authClient.twoFactor.enable({ password });
    setBusy(false);
    if (res.error) {
      setError(res.error.message ?? "Could not enable 2FA");
      return;
    }
    const data = res.data as { totpURI?: string; backupCodes?: string[] } | null;
    toast.success("2FA enabled. Save your backup codes.");
    setTwoFaEnabled(true);
    if (data?.totpURI) {
      alert(
        `Add to your authenticator app:\n\n${data.totpURI}\n\nBackup codes:\n${(data.backupCodes ?? []).join("\n")}`,
      );
    }
    setPassword("");
  }

  async function revoke(token: string) {
    const res = await authClient.revokeSession({ token });
    if (res.error) {
      toast.error(res.error.message ?? "Could not revoke");
      return;
    }
    setSessions((s) => s.filter((r) => r.token !== token));
    toast.success("Session revoked");
  }

  const Shell = ({
    title,
    description,
    children,
    footer,
  }: {
    title: string;
    description?: string;
    children?: React.ReactNode;
    footer?: React.ReactNode;
  }) => (
    <main className="mx-auto flex min-h-svh max-w-md flex-col items-center justify-center p-6">
      <Card className="w-full">
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </CardHeader>
        {children && <CardContent>{children}</CardContent>}
        {footer && <CardFooter className="text-sm">{footer}</CardFooter>}
      </Card>
    </main>
  );

  if (loading) return <Shell title="Loading…" />;

  return (
    <Shell
      title="Security"
      description="Two-factor auth & active sessions"
      footer={
        <Link href="/settings/account" className="hover:underline">
          Account
        </Link>
      }
    >
      <div className="flex flex-col gap-6">
        <div>
          <div className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Two-factor authentication
          </div>
          {twoFaEnabled ? (
            <div className="rounded-md border bg-muted p-3 text-sm">
              <div className="flex items-center gap-2">
                <span className="text-green-600">✓</span>
                <span>Enabled</span>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
              <div className="flex flex-col gap-2">
                <Label htmlFor="pw">Confirm password</Label>
                <Input
                  id="pw"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    setPassword(e.target.value)
                  }
                />
              </div>
              <Button onClick={enable2fa} disabled={busy}>
                {busy ? "…" : "Enable 2FA"}
              </Button>
            </div>
          )}
        </div>
        <div>
          <div className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Active sessions
          </div>
          {sessions.length === 0 ? (
            <div className="text-sm text-muted-foreground">No other sessions.</div>
          ) : (
            <ul className="space-y-2">
              {sessions.map((s) => (
                <li
                  key={s.id}
                  className="flex items-center justify-between rounded-md border p-3 text-sm"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate">{s.userAgent ?? "Unknown device"}</div>
                    <div className="text-xs text-muted-foreground">
                      {s.ipAddress ?? "?"} · {formatDate(s.createdAt)}
                    </div>
                  </div>
                  <Button variant="outline" onClick={() => revoke(s.token)}>
                    Revoke
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Shell>
  );
}
