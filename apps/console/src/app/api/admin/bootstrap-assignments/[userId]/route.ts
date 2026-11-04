import {
  proxyRequestToAuthServer,
  requireAdminSession,
  withSearch,
} from "@/lib/admin-bff";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ userId: string }>;
};

export async function GET(req: Request, context: RouteContext): Promise<Response> {
  const auth = await requireAdminSession(req);
  if (auth instanceof Response) {
    return auth;
  }

  const { userId } = await context.params;
  const url = new URL(req.url);

  return proxyRequestToAuthServer(
    withSearch(`/admin/bootstrap/assignments/${userId}`, url.searchParams),
    {
      req,
      cookieHeader: auth.cookieHeader,
      method: "GET",
    },
  );
}

export async function PUT(req: Request, context: RouteContext): Promise<Response> {
  const auth = await requireAdminSession(req);
  if (auth instanceof Response) {
    return auth;
  }

  const { userId } = await context.params;
  return proxyRequestToAuthServer(`/admin/bootstrap/assignments/${userId}`, {
    req,
    cookieHeader: auth.cookieHeader,
    method: "PUT",
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

  const { userId } = await context.params;
  return proxyRequestToAuthServer(`/admin/bootstrap/assignments/${userId}`, {
    req,
    cookieHeader: auth.cookieHeader,
    method: "DELETE",
  });
}
