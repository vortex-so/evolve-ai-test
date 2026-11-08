import {
  proxyJsonToAuthServer,
  proxyRequestToAuthServer,
  readJsonBody,
  requireAdminSession,
  withSearch,
} from "@/lib/admin-bff";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(req: Request, context: RouteContext): Promise<Response> {
  const auth = await requireAdminSession(req);
  if (auth instanceof Response) return auth;
  const { id } = await context.params;
  return proxyRequestToAuthServer(`/admin/users/${id}/byok/odoo`, {
    req,
    cookieHeader: auth.cookieHeader,
    method: "GET",
  });
}

export async function PUT(req: Request, context: RouteContext): Promise<Response> {
  const auth = await requireAdminSession(req);
  if (auth instanceof Response) return auth;
  const { id } = await context.params;
  return proxyJsonToAuthServer(`/admin/users/${id}/byok/odoo`, {
    req,
    cookieHeader: auth.cookieHeader,
    method: "PUT",
    body: await readJsonBody(req),
  });
}

export async function DELETE(req: Request, context: RouteContext): Promise<Response> {
  const auth = await requireAdminSession(req);
  if (auth instanceof Response) return auth;
  const { id } = await context.params;
  const url = new URL(req.url);
  return proxyRequestToAuthServer(withSearch(`/admin/users/${id}/byok/odoo`, url.searchParams), {
    req,
    cookieHeader: auth.cookieHeader,
    method: "DELETE",
  });
}
