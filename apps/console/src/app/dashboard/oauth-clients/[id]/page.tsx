import { OauthClientDetail } from "./oauth-client-detail";

import { fetchAdminPageJson } from "@/lib/admin-page-fetch";
import { getErrorMessage } from "@/lib/fetch-json";

import {
  normalizeOAuthClient,
  parseArrayish,
  type OAuthClient,
  type OAuthConsent,
  type OAuthClientsResponse,
} from "../types";

type RouteContext = {
  params: Promise<{ id: string }>;
};

type ConsentRow = {
  id?: string;
  userId?: string | null;
  scopes?: string | string[];
  createdAt?: string | number | null;
  updatedAt?: string | number | null;
};

type UserDetailsResponse = {
  user?: {
    email?: string | null;
  } | null;
};

export const dynamic = "force-dynamic";

async function lookupUserEmails(userIds: string[]): Promise<Map<string, string>> {
  const entries = await Promise.all(
    userIds.map(async (userId) => {
      try {
        const response = await fetchAdminPageJson<UserDetailsResponse>(`/api/admin/users/${userId}`);
        return [userId, response.user?.email ?? ""] as const;
      } catch {
        return [userId, ""] as const;
      }
    }),
  );

  return new Map(entries.filter((entry) => entry[1]));
}

export default async function OAuthClientDetailPage({ params }: RouteContext) {
  const { id } = await params;
  let client: OAuthClient | null = null;
  let consents: OAuthConsent[] = [];
  let error: string | null = null;

  try {
    const [clientResponse, consentResponse] = await Promise.all([
      fetchAdminPageJson<unknown>(`/api/admin/oauth-clients/${id}`),
      fetchAdminPageJson<OAuthClientsResponse>(`/api/admin/oauth-clients/${id}/consents`),
    ]);

    client = normalizeOAuthClient(clientResponse);

    const consentRows = (consentResponse.items ?? consentResponse.rows ?? []) as ConsentRow[];
    const userIds = Array.from(
      new Set(consentRows.map((row) => row.userId).filter((value): value is string => Boolean(value))),
    );
    const userEmails = await lookupUserEmails(userIds);

    consents = consentRows.map((row) => ({
      id: row.id ?? crypto.randomUUID(),
      userId: row.userId ?? null,
      userEmail: row.userId ? userEmails.get(row.userId) ?? null : null,
      scopes: parseArrayish(row.scopes, " "),
      grantedAt: row.createdAt ?? row.updatedAt ?? null,
    }));
  } catch (nextError) {
    error = getErrorMessage(nextError, "Failed to load the OAuth client detail.");
  }

  return <OauthClientDetail client={client} consents={consents} error={error} />;
}
