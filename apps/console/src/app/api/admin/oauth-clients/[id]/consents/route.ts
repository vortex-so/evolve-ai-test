import {
  proxyRequestToAuthServer,
  requireAdminSession,
  withSearch,
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
  const url = new URL(req.url);

  return proxyRequestToAuthServer(
    withSearch(`/admin/oauth-clients/${id}/consents`, url.searchParams),
    {
      req,
      cookieHeader: auth.cookieHeader,
      method: "GET",
    },
  );
}
