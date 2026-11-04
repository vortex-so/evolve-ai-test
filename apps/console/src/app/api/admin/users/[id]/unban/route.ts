import { proxyJsonToAuthServer, requireAdminSession } from "@/lib/admin-bff";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(req: Request, context: RouteContext): Promise<Response> {
  const auth = await requireAdminSession(req);
  if (auth instanceof Response) {
    return auth;
  }

  const { id } = await context.params;

  return proxyJsonToAuthServer("/api/auth/admin/unban-user", {
    req,
    cookieHeader: auth.cookieHeader,
    body: { userId: id },
  });
}
