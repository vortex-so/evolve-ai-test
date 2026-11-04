"use client";

import { useMemo, useState } from "react";
import { AlertCircle } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@vortex/ui/components/alert";
import { ConfirmDialog } from "@vortex/ui/components/confirm-dialog";
import { DataTable } from "@vortex/ui/components/data-table";

import { fetchJsonOrThrow, mutateOrThrow } from "@/lib/admin-client";
import {
  formatDateTime,
  getErrorMessage,
  normalizeAdminSessionsResponse,
  type AdminSessionItem,
  type CursorPage,
} from "@/lib/admin-types";

type SessionsTableProps = {
  initialPage: CursorPage<AdminSessionItem>;
  initialError?: string;
};

export function SessionsTable({ initialPage, initialError }: SessionsTableProps) {
  const queryClient = useQueryClient();
  const [cursorStack, setCursorStack] = useState<string[]>([]);
  const [selectedSession, setSelectedSession] = useState<AdminSessionItem | null>(null);
  const currentCursor = cursorStack[cursorStack.length - 1] ?? null;

  const sessionsQuery = useQuery({
    queryKey: ["admin-sessions", currentCursor],
    queryFn: async () => {
      const search = new URLSearchParams({ limit: "20" });
      if (currentCursor) {
        search.set("cursor", currentCursor);
      }

      return normalizeAdminSessionsResponse(await fetchJsonOrThrow<unknown>(`/api/admin/sessions?${search.toString()}`));
    },
    initialData: currentCursor ? undefined : initialPage,
  });

  const revokeMutation = useMutation({
    mutationFn: async (session: AdminSessionItem) => {
      if (!session.userId || !session.token) {
        throw new Error("This session cannot be revoked because its identifiers are incomplete.");
      }

      await mutateOrThrow(`/api/admin/users/${session.userId}/sessions?token=${encodeURIComponent(session.token)}`, {
        method: "DELETE",
      });
      await queryClient.invalidateQueries({ queryKey: ["admin-sessions"] });
      toast.success("Session revoked.");
    },
    onError: (error) => {
      toast.error(getErrorMessage(error));
    },
  });

  const columns = useMemo<ColumnDef<AdminSessionItem>[]>(
    () => [
      {
        accessorKey: "userEmail",
        header: "User",
        cell: ({ row }) => (
          <div className="min-w-0">
            <p className="truncate font-medium">{row.original.userName ?? row.original.userEmail ?? row.original.userId ?? "Unknown user"}</p>
            <p className="truncate text-xs text-muted-foreground">{row.original.userEmail ?? row.original.userId ?? "-"}</p>
          </div>
        ),
      },
      {
        accessorKey: "ipAddress",
        header: "IP",
        cell: ({ row }) => row.original.ipAddress ?? "-",
      },
      {
        accessorKey: "userAgent",
        header: "User Agent",
        cell: ({ row }) => (
          <span className="block max-w-[28rem] truncate" title={row.original.userAgent ?? ""}>
            {row.original.userAgent ?? "-"}
          </span>
        ),
      },
      {
        accessorKey: "createdAt",
        header: "Created At",
        cell: ({ row }) => formatDateTime(row.original.createdAt),
      },
      {
        id: "actions",
        header: "Actions",
        cell: ({ row }) => (
          <button
            type="button"
            className="text-sm font-medium text-destructive hover:underline"
            onClick={() => setSelectedSession(row.original)}
          >
            Revoke
          </button>
        ),
      },
    ],
    []
  );

  const tableError = sessionsQuery.error
    ? getErrorMessage(sessionsQuery.error)
    : (sessionsQuery.data?.items.length ?? 0) > 0
      ? undefined
      : initialError;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold">Sessions</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Review active sessions across all users and revoke compromised tokens.
        </p>
      </div>

      {tableError ? (
        <Alert variant="destructive">
          <AlertCircle className="size-4" />
          <AlertTitle>Sessions request failed</AlertTitle>
          <AlertDescription>{tableError}</AlertDescription>
        </Alert>
      ) : null}

      <DataTable
        columns={columns}
        data={sessionsQuery.data?.items ?? []}
        loading={sessionsQuery.isLoading}
        emptyMessage="No sessions found."
        cursor={{
          next: sessionsQuery.data?.nextCursor ?? undefined,
          hasPrev: cursorStack.length > 0,
          onNext: () => {
            const nextCursor = sessionsQuery.data?.nextCursor;
            if (!nextCursor) return;
            setCursorStack((current) => [...current, nextCursor]);
          },
          onPrev: () => {
            setCursorStack((current) => current.slice(0, -1));
          },
        }}
      />

      <ConfirmDialog
        open={selectedSession !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedSession(null);
        }}
        title="Revoke this session?"
        description="This ends the selected session immediately."
        confirmLabel="Revoke session"
        variant="destructive"
        onConfirm={async () => {
          if (!selectedSession) return;
          await revokeMutation.mutateAsync(selectedSession);
          setSelectedSession(null);
        }}
      />
    </div>
  );
}
