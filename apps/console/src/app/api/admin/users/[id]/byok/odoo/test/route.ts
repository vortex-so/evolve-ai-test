import { proxyJsonToAuthServer, readJsonBody, requireAdminSession } from "@/lib/admin-bff";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(req: Request, context: RouteContext): Promise<Response> {
  const auth = await requireAdminSession(req);
  if (auth instanceof Response) return auth;
  const { id } = await context.params;
  return proxyJsonToAuthServer(`/admin/users/${id}/byok/odoo/test`, {
    req,
    cookieHeader: auth.cookieHeader,
    body: await readJsonBody(req),
  });
}
