import { Alert, AlertDescription } from "@vortex/ui/components/alert";

import { fetchAdminJson } from "../_lib/admin-fetch";
import { AuditTable, type AuditRow } from "./audit-table";

export const dynamic = "force-dynamic";

type AuditResponse = {
  rows?: AuditRow[];
  items?: AuditRow[];
  next_cursor?: string | null;
};

type AuditPageProps = {
  searchParams: Promise<{
    actor?: string;
    action?: string;
    target_type?: string;
    target_id?: string;
    outcome?: string;
    from?: string;
    to?: string;
    cursor?: string;
  }>;
};

function buildAuditQuery(params: Awaited<AuditPageProps["searchParams"]>): string {
  const search = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string" && value.trim()) {
      search.set(key, value.trim());
    }
  }

  return search.toString();
}

export default async function AuditPage({ searchParams }: AuditPageProps) {
  const resolvedSearchParams = await searchParams;
  const query = buildAuditQuery(resolvedSearchParams);

  try {
    const data = await fetchAdminJson<AuditResponse>(
      `/api/admin/audit${query ? `?${query}` : ""}`,
    );

    return (
      <section className="space-y-6">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Audit Log</h1>
          <p className="text-sm text-muted-foreground">
            Review administrative changes, outcomes, and target snapshots.
          </p>
        </div>
        <AuditTable
          initialRows={data.rows ?? data.items ?? []}
          nextCursor={data.next_cursor ?? null}
        />
      </section>
    );
  } catch (error) {
    const message =
      typeof error === "object" &&
      error !== null &&
      "message" in error &&
      typeof error.message === "string"
        ? error.message
        : "Failed to load audit entries.";

    return (
      <section className="space-y-6">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Audit Log</h1>
          <p className="text-sm text-muted-foreground">
            Review administrative changes, outcomes, and target snapshots.
          </p>
        </div>
        <Alert variant="destructive">
          <AlertDescription>{message}</AlertDescription>
        </Alert>
        <AuditTable initialRows={[]} nextCursor={null} initialError={message} />
      </section>
    );
  }
}
