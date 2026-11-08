import { requireAdminSession } from "@/lib/admin-bff";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(req: Request, context: RouteContext): Promise<Response> {
  const auth = await requireAdminSession(req);
  if (auth instanceof Response) return auth;
  void context;
  return Response.json({
    error: "custom_approval_retired",
    message: "Custom BYOK approvals are retired. Use native Odoo controls on the user page.",
  }, {
    status: 410,
  });
}
