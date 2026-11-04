import { OauthClientsTable } from "./oauth-clients-table";

import { fetchAdminPageJson } from "@/lib/admin-page-fetch";
import { getErrorMessage } from "@/lib/fetch-json";

import { normalizeOAuthClientsResponse, type OAuthClientsResponse } from "./types";
import type { OAuthClient } from "./types";

export const dynamic = "force-dynamic";

export default async function OAuthClientsPage() {
  let initialClients: OAuthClient[] = [];
  let initialError: string | null = null;

  try {
    const response = await fetchAdminPageJson<OAuthClientsResponse>("/api/admin/oauth-clients");
    initialClients = normalizeOAuthClientsResponse(response);
  } catch (error) {
    initialError = getErrorMessage(error, "Failed to load OAuth clients.");
  }

  return <OauthClientsTable initialClients={initialClients} initialError={initialError} />;
}
