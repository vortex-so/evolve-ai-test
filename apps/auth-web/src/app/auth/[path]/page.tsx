import { viewPaths } from "@better-auth-ui/core";
import { notFound } from "next/navigation";

import { Auth } from "@vortex/ui/components/auth/auth";

export function generateStaticParams() {
  return Object.values(viewPaths.auth).map((path) => ({ path }));
}

export default async function AuthPage({
  params,
}: {
  params: Promise<{ path: string }>;
}) {
  const { path } = await params;

  if (!Object.values(viewPaths.auth).includes(path)) {
    notFound();
  }

  return <Auth path={path} />;
}
