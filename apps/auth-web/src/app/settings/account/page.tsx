"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";

import { Button } from "@vortex/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@vortex/ui/components/card";

import { authClient } from "@/lib/auth-client";

type User = {
  id: string;
  email: string;
  name?: string;
  emailVerified?: boolean;
};

export default function AccountSettingsPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const res = await authClient.getSession();
      if (res.error || !res.data) {
        router.replace("/auth/sign-in?redirect=/settings/account");
        return;
      }
      setUser(res.data.user as User);
      setLoading(false);
    })();
  }, [router]);

  async function signOut() {
    await authClient.signOut();
    toast.success("Signed out");
    router.replace("/auth/sign-in");
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

  if (loading || !user) return <Shell title="Loading…" />;

  return (
    <Shell
      title="Account"
      description="Manage your Vortex Auth profile"
      footer={
        <Link href="/settings/security" className="hover:underline">
          Security &amp; sessions
        </Link>
      }
    >
      <div className="space-y-3 text-sm">
        <div>
          <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Name
          </div>
          <div>{user.name || "—"}</div>
        </div>
        <div>
          <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Email
          </div>
          <div className="flex items-center gap-2">
            <span>{user.email}</span>
            {user.emailVerified ? (
              <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-800 dark:bg-green-900/30 dark:text-green-400">
                verified
              </span>
            ) : (
              <span className="rounded-full bg-yellow-100 px-2 py-0.5 text-xs text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400">
                unverified
              </span>
            )}
          </div>
        </div>
      </div>
      <div className="mt-6">
        <Button variant="outline" onClick={signOut} className="w-full">
          Sign out
        </Button>
      </div>
    </Shell>
  );
}
