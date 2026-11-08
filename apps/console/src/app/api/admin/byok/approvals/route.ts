import { requireAdminSession } from "@/lib/admin-bff";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const auth = await requireAdminSession(req);
  if (auth instanceof Response) return auth;
  return Response.json({
    error: "custom_approval_retired",
    message: "Custom BYOK approvals are retired. Use native Odoo controls on the user page.",
  }, {
    status: 410,
  });
}
