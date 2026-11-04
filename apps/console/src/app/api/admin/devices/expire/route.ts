import { proxyRequestToAuthServer, requireAdminSession } from "@/lib/admin-bff";

export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  const auth = await requireAdminSession(req);
  if (auth instanceof Response) {
    return auth;
  }

  return proxyRequestToAuthServer("/admin/devices/expire", {
    req,
    cookieHeader: auth.cookieHeader,
    method: "POST",
    body: await req.text(),
  });
}
