"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { MoreHorizontal, Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@vortex/ui/components/badge";
import { Button } from "@vortex/ui/components/button";
import { ConfirmDialog } from "@vortex/ui/components/confirm-dialog";
import { DataTable } from "@vortex/ui/components/data-table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@vortex/ui/components/dropdown-menu";

import { fetchJsonOrThrow } from "@/lib/admin-client";
import { getErrorMessage, normalizeAdminUsersResponse, type AdminUser } from "@/lib/admin-types";

import { AssignProfileDialog } from "./assign-profile-dialog";
import { BootstrapProfileEditor } from "./bootstrap-profile-editor";

export type BootstrapProfileRecord = {
  id: string;
  name: string;
  description: string | null;
  config: Record<string, unknown>;
  schema_version: number;
  is_default: number;
  is_system: number;
  created_at: number;
  updated_at: number;
};

type BootstrapProfilesTableProps = {
  initialProfiles: BootstrapProfileRecord[];
  initialError?: string;
};

function formatDate(value: number): string {
  return new Date(value).toISOString();
}

export function BootstrapProfilesTable({
  initialProfiles,
  initialError,
}: BootstrapProfilesTableProps) {
  const [profiles, setProfiles] = useState(initialProfiles);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>(initialError);
  const [editorProfile, setEditorProfile] = useState<BootstrapProfileRecord | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [assignProfile, setAssignProfile] = useState<BootstrapProfileRecord | null>(null);
  const [assignOpen, setAssignOpen] = useState(false);
  const [profileToDelete, setProfileToDelete] = useState<BootstrapProfileRecord | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [directoryUsers, setDirectoryUsers] = useState<AdminUser[]>([]);
  const [assignments, setAssignments] = useState<Record<string, string>>({});
  const [assignmentsLoading, setAssignmentsLoading] = useState(true);
  const [assignmentsError, setAssignmentsError] = useState<string | undefined>();
  const [assignmentsVersion, setAssignmentsVersion] = useState(0);

  async function refreshProfiles() {
    setLoading(true);
    setError(undefined);

    try {
      const response = await fetch("/api/admin/bootstrap-profiles", { cache: "no-store" });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `Request failed with status ${response.status}`);
      }

      const body = (await response.json()) as {
        items?: BootstrapProfileRecord[];
        rows?: BootstrapProfileRecord[];
      };

      setProfiles(body.items ?? body.rows ?? []);
    } catch (fetchError) {
      const message =
        fetchError instanceof Error ? fetchError.message : "Failed to refresh profiles";
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function loadAssignments() {
      setAssignmentsLoading(true);
      try {
        const users = normalizeAdminUsersResponse(
          await fetchJsonOrThrow<unknown>("/api/admin/users?limit=100", { cache: "no-store" }),
        ).items.filter((user) => user.id);

        const entries = await Promise.all(
          users.map(async (user) => {
            const response = await fetch(
              `/api/admin/bootstrap-assignments/${encodeURIComponent(user.id)}`,
              { cache: "no-store" },
            );
            if (!response.ok) {
              return null;
            }

            const payload = (await response.json()) as {
              assignment?: { profile_id?: string | null } | null;
            };
            const profileId = payload.assignment?.profile_id;
            return profileId ? ([user.id, profileId] as const) : null;
          }),
        );

        if (cancelled) {
          return;
        }

        setDirectoryUsers(users);
        setAssignments(
          Object.fromEntries(
            entries.filter((entry): entry is readonly [string, string] => entry !== null),
          ),
        );
        setAssignmentsError(undefined);
      } catch (loadError) {
        if (!cancelled) {
          setDirectoryUsers([]);
          setAssignments({});
          setAssignmentsError(getErrorMessage(loadError, "Could not load users."));
        }
      } finally {
        if (!cancelled) {
          setAssignmentsLoading(false);
        }
      }
    }

    void loadAssignments();

    return () => {
      cancelled = true;
    };
  }, [profiles, assignmentsVersion]);

  const assignmentCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const profileId of Object.values(assignments)) {
      counts[profileId] = (counts[profileId] ?? 0) + 1;
    }
    return counts;
  }, [assignments]);

  const columns = useMemo<ColumnDef<BootstrapProfileRecord>[]>(
    () => [
      {
        id: "name",
        header: "Name",
        cell: ({ row }) => (
          <div className="space-y-1">
            <p className="font-medium">{row.original.name}</p>
            {row.original.description ? (
              <p className="text-xs text-muted-foreground">{row.original.description}</p>
            ) : null}
          </div>
        ),
      },
      {
        accessorKey: "description",
        header: "Description",
        cell: ({ row }) => row.original.description || "-",
      },
      {
        id: "default",
        header: "Default",
        cell: ({ row }) =>
          row.original.is_default ? <Badge>Default</Badge> : <span className="text-muted-foreground">-</span>,
      },
      {
        id: "system",
        header: "System",
        cell: ({ row }) =>
          row.original.is_system ? <Badge variant="outline">System</Badge> : <span className="text-muted-foreground">-</span>,
      },
      {
        id: "assigned",
        header: "Users Assigned",
        cell: ({ row }) => assignmentCounts[row.original.id] ?? 0,
      },
      {
        accessorKey: "updated_at",
        header: "Updated At",
        cell: ({ row }) => formatDate(row.original.updated_at),
      },
      {
        id: "actions",
        header: "Actions",
        cell: ({ row }) => {
          const profile = row.original;
          return (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" onClick={(event) => event.stopPropagation()}>
                  <MoreHorizontal className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onSelect={() => {
                    setEditorProfile(profile);
                    setEditorOpen(true);
                  }}
                >
                  Edit
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => {
                    setAssignProfile(profile);
                    setAssignOpen(true);
                  }}
                >
                  Assign users
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={Boolean(profile.is_system)}
                  onSelect={() => setProfileToDelete(profile)}
                  className="text-destructive"
                >
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          );
        },
      },
    ],
    [assignmentCounts],
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Bootstrap Profiles</h1>
          <p className="text-sm text-muted-foreground">
            Manage reusable bootstrap configurations and assign them to users.
          </p>
        </div>
        <Button
          type="button"
          onClick={() => {
            setEditorProfile(null);
            setEditorOpen(true);
          }}
        >
          <Plus className="size-4" />
          New profile
        </Button>
      </div>

      <DataTable
        columns={columns}
        data={profiles}
        loading={loading}
        error={error}
        emptyMessage="No bootstrap profiles found."
        getRowId={(row) => row.id}
      />

      <BootstrapProfileEditor
        open={editorOpen}
        onOpenChange={setEditorOpen}
        profile={editorProfile}
        existingNames={profiles.map((profile) => profile.name)}
        onSaved={refreshProfiles}
      />

      <AssignProfileDialog
        open={assignOpen}
        onOpenChange={setAssignOpen}
        profile={assignProfile}
        profiles={profiles}
        users={directoryUsers}
        assignments={assignments}
        loading={assignmentsLoading && directoryUsers.length === 0}
        error={assignmentsError}
        onAssigned={() => setAssignmentsVersion((version) => version + 1)}
      />

      <ConfirmDialog
        open={Boolean(profileToDelete)}
        onOpenChange={(open) => {
          if (!open) {
            setProfileToDelete(null);
          }
        }}
        title="Delete bootstrap profile?"
        description={`This permanently deletes ${profileToDelete?.name ?? "this profile"}.`}
        confirmLabel="Delete profile"
        variant="destructive"
        loading={deleting}
        onConfirm={async () => {
          if (!profileToDelete) {
            return;
          }

          setDeleting(true);

          try {
            const response = await fetch(`/api/admin/bootstrap-profiles/${profileToDelete.id}`, {
              method: "DELETE",
            });

            if (!response.ok) {
              const body = (await response.json().catch(() => null)) as
                | { error?: string; code?: string; message?: string }
                | null;

              if (response.status === 409 && body?.error === "system_profile_protected") {
                toast.error(body.message ?? "System profiles cannot be deleted");
                return;
              }

              throw new Error(body?.error ?? `Request failed with status ${response.status}`);
            }

            toast.success("Profile deleted");
            setProfileToDelete(null);
            await refreshProfiles();
          } catch (deleteError) {
            toast.error(
              deleteError instanceof Error ? deleteError.message : "Failed to delete profile",
            );
          } finally {
            setDeleting(false);
          }
        }}
      />
    </div>
  );
}
