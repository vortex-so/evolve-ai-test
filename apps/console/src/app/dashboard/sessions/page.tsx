import { AlertCircle } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@vortex/ui/components/alert";

import { fetchAdminResponse } from "@/lib/admin-server";
import { normalizeAdminSessionsResponse } from "@/lib/admin-types";

import { SessionsTable } from "./sessions-table";

export const dynamic = "force-dynamic";

export default async function SessionsPage() {
  try {
    const response = await fetchAdminResponse("/api/admin/sessions?limit=20");

    if (!response.ok) {
      throw new Error(`Request failed with status ${response.status}`);
    }

    const data = normalizeAdminSessionsResponse(await response.json());
    return <SessionsTable initialPage={data} />;
  } catch (error) {
    return (
      <div className="space-y-6">
        <Alert variant="destructive">
          <AlertCircle className="size-4" />
          <AlertTitle>Could not load sessions</AlertTitle>
          <AlertDescription>
            {error instanceof Error ? error.message : "Something went wrong while loading sessions."}
          </AlertDescription>
        </Alert>
        <SessionsTable initialPage={{ items: [], nextCursor: null, total: 0 }} initialError="Could not load sessions." />
      </div>
    );
  }
}
