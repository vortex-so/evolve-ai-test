"use client";

import { useState } from "react";
import { LogOut } from "lucide-react";

import { Button } from "@vortex/ui/components/button";

import { authClient } from "@/lib/auth-client";

const AUTH_APP_ORIGIN =
  process.env.NEXT_PUBLIC_AUTH_WEB_URL ?? "https://auth.auth-dev.vortex.so";

export function SignOutButton() {
  const [pending, setPending] = useState(false);

  const handleSignOut = async () => {
    try {
      setPending(true);
      await authClient.signOut({
        fetchOptions: {
          onSuccess: () => {
            window.location.href = AUTH_APP_ORIGIN;
          },
        },
      });
    } finally {
      setPending(false);
    }
  };

  return (
    <Button variant="outline" size="sm" onClick={handleSignOut} disabled={pending}>
      <LogOut className="size-4" />
      {pending ? "Signing out..." : "Sign out"}
    </Button>
  );
}
