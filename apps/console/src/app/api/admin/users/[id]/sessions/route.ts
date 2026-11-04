import {
  proxyJsonToAuthServer,
  requireAdminSession,
} from "@/lib/admin-bff";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(req: Request, context: RouteContext): Promise<Response> {
  const auth = await requireAdminSession(req);
  if (auth instanceof Response) {
    return auth;
  }

  const { id } = await context.params;

  return proxyJsonToAuthServer("/api/auth/admin/list-user-sessions", {
    req,
    cookieHeader: auth.cookieHeader,
    body: { userId: id },
  });
}

export async function DELETE(
  req: Request,
  context: RouteContext,
): Promise<Response> {
  const auth = await requireAdminSession(req);
  if (auth instanceof Response) {
    return auth;
  }

  const { id } = await context.params;
  const url = new URL(req.url);
  const token = url.searchParams.get("token");

  if (!token) {
    return proxyJsonToAuthServer("/api/auth/admin/revoke-user-sessions", {
      req,
      cookieHeader: auth.cookieHeader,
      body: { userId: id },
    });
  }

  return proxyJsonToAuthServer("/api/auth/admin/revoke-user-session", {
    req,
    cookieHeader: auth.cookieHeader,
    body: { sessionToken: token },
  });
}
