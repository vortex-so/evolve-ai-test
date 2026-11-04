import { AlertCircle } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@vortex/ui/components/alert";

import { fetchAdminResponse } from "@/lib/admin-server";
import { normalizeAdminUsersResponse } from "@/lib/admin-types";

import { UsersTable } from "./users-table";

export const dynamic = "force-dynamic";

type UsersPageProps = {
  searchParams: Promise<{ search?: string }>;
};

export default async function UsersPage({ searchParams }: UsersPageProps) {
  const { search = "" } = await searchParams;

  try {
    const response = await fetchAdminResponse("/api/admin/users");

    if (!response.ok) {
      throw new Error(`Request failed with status ${response.status}`);
    }

    const data = normalizeAdminUsersResponse(await response.json());

    return <UsersTable initialUsers={data.items} initialSearch={search} />;
  } catch (error) {
    return (
      <div className="space-y-6">
        <Alert variant="destructive">
          <AlertCircle className="size-4" />
          <AlertTitle>Could not load users</AlertTitle>
          <AlertDescription>
            {error instanceof Error ? error.message : "Something went wrong while loading users."}
          </AlertDescription>
        </Alert>
        <UsersTable initialUsers={[]} initialSearch={search} initialError="Could not load users." />
      </div>
    );
  }
}
