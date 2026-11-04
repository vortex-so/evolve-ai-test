import {
  proxyRequestToAuthServer,
  requireAdminSession,
  withSearch,
} from "@/lib/admin-bff";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const auth = await requireAdminSession(req);
  if (auth instanceof Response) {
    return auth;
  }

  const url = new URL(req.url);
  return proxyRequestToAuthServer(withSearch("/admin/sessions", url.searchParams), {
    req,
    cookieHeader: auth.cookieHeader,
    method: "GET",
  });
}
