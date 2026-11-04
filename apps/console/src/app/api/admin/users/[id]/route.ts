import {
  proxyJsonToAuthServer,
  proxyRequestToAuthServer,
  requireAdminSession,
  withSearch,
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
  const url = new URL(req.url);

  return proxyRequestToAuthServer(
    withSearch(`/admin/user/${id}/details`, url.searchParams),
    {
      req,
      cookieHeader: auth.cookieHeader,
      method: "GET",
    },
  );
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
  return proxyJsonToAuthServer("/api/auth/admin/remove-user", {
    req,
    cookieHeader: auth.cookieHeader,
    body: { userId: id },
  });
}
