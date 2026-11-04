import {
  proxyRequestToAuthServer,
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
  return proxyRequestToAuthServer(`/admin/oauth-clients/${id}`, {
    req,
    cookieHeader: auth.cookieHeader,
    method: "GET",
  });
}

export async function PATCH(
  req: Request,
  context: RouteContext,
): Promise<Response> {
  const auth = await requireAdminSession(req);
  if (auth instanceof Response) {
    return auth;
  }

  const { id } = await context.params;
  return proxyRequestToAuthServer(`/admin/oauth-clients/${id}`, {
    req,
    cookieHeader: auth.cookieHeader,
    method: "PATCH",
    body: await req.text(),
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
  return proxyRequestToAuthServer(`/admin/oauth-clients/${id}`, {
    req,
    cookieHeader: auth.cookieHeader,
    method: "DELETE",
  });
}
