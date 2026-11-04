"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
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
import { Input } from "@vortex/ui/components/input";
import { Label } from "@vortex/ui/components/label";

import { authClient } from "@/lib/auth-client";

export default function TwoFactorPage() {
  const router = useRouter();
  const params = useSearchParams();
  const redirect = params.get("redirect") ?? "/settings/account";
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const res = await authClient.twoFactor.verifyTotp({ code });
    setBusy(false);
    if (res.error) {
      setError(res.error.message ?? "Invalid code");
      return;
    }
    toast.success("Signed in");
    router.push(redirect);
  }

  async function sendOtp() {
    setError(null);
    const res = await authClient.twoFactor.sendOtp();
    if (res.error) {
      setError(res.error.message ?? "Could not send OTP");
      return;
    }
    toast.success("Code sent to your email");
  }

  return (
    <main className="mx-auto flex min-h-svh max-w-md flex-col items-center justify-center p-6">
      <Card className="w-full">
        <CardHeader>
          <CardTitle>Two-factor authentication</CardTitle>
          <CardDescription>
            Enter the 6-digit code from your authenticator app or email.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="flex flex-col gap-4">
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <div className="flex flex-col gap-2">
              <Label htmlFor="code">Code</Label>
              <Input
                id="code"
                name="code"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                autoComplete="one-time-code"
                required
                maxLength={6}
                autoFocus
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              />
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={sendOtp}
                className="flex-1"
              >
                Email me a code
              </Button>
              <Button
                type="submit"
                disabled={busy || code.length !== 6}
                className="flex-1"
              >
                {busy ? "Verifying…" : "Verify"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
