import {
  proxyJsonToAuthServer,
  readJsonBody,
  requireAdminSession,
} from "@/lib/admin-bff";

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
  const body = await readJsonBody(req);

  return proxyJsonToAuthServer("/api/auth/admin/set-role", {
    req,
    cookieHeader: auth.cookieHeader,
    body: {
      ...body,
      userId: id,
    },
  });
}
