import { Alert, AlertDescription } from "@vortex/ui/components/alert";

import { fetchAdminJson } from "../_lib/admin-fetch";
import {
  BootstrapProfilesTable,
  type BootstrapProfileRecord,
} from "./bootstrap-profiles-table";

export const dynamic = "force-dynamic";

type BootstrapProfilesResponse = {
  rows?: BootstrapProfileRecord[];
  items?: BootstrapProfileRecord[];
};

export default async function BootstrapProfilesPage() {
  try {
    const data = await fetchAdminJson<BootstrapProfilesResponse>("/api/admin/bootstrap-profiles");
    return <BootstrapProfilesTable initialProfiles={data.rows ?? data.items ?? []} />;
  } catch (error) {
    const message =
      typeof error === "object" &&
      error !== null &&
      "message" in error &&
      typeof error.message === "string"
        ? error.message
        : "Failed to load bootstrap profiles.";

    return (
      <section className="space-y-4">
        <Alert variant="destructive">
          <AlertDescription>{message}</AlertDescription>
        </Alert>
        <BootstrapProfilesTable initialProfiles={[]} initialError={message} />
      </section>
    );
  }
}
