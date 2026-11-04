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
  return proxyRequestToAuthServer(
    withSearch("/api/auth/admin/list-users", url.searchParams),
    {
      req,
      cookieHeader: auth.cookieHeader,
      method: "GET",
    },
  );
}

export async function POST(req: Request): Promise<Response> {
  const auth = await requireAdminSession(req);
  if (auth instanceof Response) {
    return auth;
  }

  return proxyRequestToAuthServer("/api/auth/admin/create-user", {
    req,
    cookieHeader: auth.cookieHeader,
    method: "POST",
    body: await req.text(),
  });
}
