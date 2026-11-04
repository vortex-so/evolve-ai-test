"use client";

import { useMemo, useState } from "react";
import { AlertCircle, MoreHorizontal } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@vortex/ui/components/alert";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@vortex/ui/components/tabs";

import { fetchJsonOrThrow, mutateOrThrow } from "@/lib/admin-client";
import {
  formatDateTime,
  formatUserDisplayName,
  getErrorMessage,
  normalizeAdminAuditResponse,
  normalizeAdminSessionsResponse,
  type AdminAuditItem,
  type AdminSessionItem,
  type AdminUserDetail,
} from "@/lib/admin-types";

type UserDetailProps = {
  user: AdminUserDetail;
};

export function UserDetail({ user }: UserDetailProps) {
  const queryClient = useQueryClient();
  const [auditCursorStack, setAuditCursorStack] = useState<string[]>([]);
  const [selectedSession, setSelectedSession] = useState<AdminSessionItem | null>(null);

  const sessionsQuery = useQuery({
    queryKey: ["admin-user-sessions", user.id],
    queryFn: async () =>
      normalizeAdminSessionsResponse(
        await fetchJsonOrThrow<unknown>(`/api/admin/users/${user.id}/sessions`)
      ),
  });

  const currentAuditCursor = auditCursorStack[auditCursorStack.length - 1] ?? null;
  const auditQuery = useQuery({
    queryKey: ["admin-user-audit", user.id, currentAuditCursor],
    queryFn: async () => {
      const search = new URLSearchParams({ target_id: user.id, limit: "20" });
      if (currentAuditCursor) {
        search.set("cursor", currentAuditCursor);
      }

      return normalizeAdminAuditResponse(await fetchJsonOrThrow<unknown>(`/api/admin/audit?${search.toString()}`));
    },
  });

  const revokeSessionMutation = useMutation({
    mutationFn: async (session: AdminSessionItem) => {
      if (!session.token) {
        throw new Error("This session does not expose a token for revocation.");
      }

      await mutateOrThrow(`/api/admin/users/${user.id}/sessions?token=${encodeURIComponent(session.token)}`, {
        method: "DELETE",
      });
      await queryClient.invalidateQueries({ queryKey: ["admin-user-sessions", user.id] });
      toast.success("Session revoked.");
    },
    onError: (error) => {
      toast.error(getErrorMessage(error));
    },
  });

  const sessionColumns = useMemo<ColumnDef<AdminSessionItem>[]>(
    () => [
      {
        accessorKey: "createdAt",
        header: "Created",
        cell: ({ row }) => formatDateTime(row.original.createdAt),
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
        accessorKey: "expiresAt",
        header: "Expires",
        cell: ({ row }) => formatDateTime(row.original.expiresAt),
      },
      {
        id: "actions",
        header: "Actions",
        cell: ({ row }) => (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Session actions">
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setSelectedSession(row.original)}>Revoke</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ),
      },
    ],
    []
  );

  const auditColumns = useMemo<ColumnDef<AdminAuditItem>[]>(
    () => [
      {
        accessorKey: "createdAt",
        header: "Created",
        cell: ({ row }) => formatDateTime(row.original.createdAt),
      },
      {
        accessorKey: "action",
        header: "Action",
        cell: ({ row }) => row.original.action ?? "-",
      },
      {
        accessorKey: "outcome",
        header: "Outcome",
        cell: ({ row }) => (
          <Badge variant={row.original.outcome === "failure" ? "destructive" : "outline"}>
            {row.original.outcome ?? "unknown"}
          </Badge>
        ),
      },
      {
        accessorKey: "actorEmail",
        header: "Actor",
        cell: ({ row }) => row.original.actorEmail ?? row.original.actorUserId ?? "-",
      },
    ],
    []
  );

  const twoFactorEnabled = user.twoFactor.some((item) => item.verified) || user.twoFactor.length > 0;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold">{formatUserDisplayName(user)}</h2>
        <p className="mt-2 text-sm text-muted-foreground">Inspect profile data, sessions, linked accounts, and user-scoped audit history.</p>
      </div>

      <Tabs defaultValue="profile">
        <TabsList>
          <TabsTrigger value="profile">Profile</TabsTrigger>
          <TabsTrigger value="sessions">Sessions</TabsTrigger>
          <TabsTrigger value="accounts">Accounts</TabsTrigger>
          <TabsTrigger value="2fa">2FA</TabsTrigger>
          <TabsTrigger value="passkeys">Passkeys</TabsTrigger>
          <TabsTrigger value="audit">Audit</TabsTrigger>
        </TabsList>

        <TabsContent value="profile" className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <FieldCard label="Name" value={user.name ?? "-"} />
          <FieldCard label="Email" value={user.email ?? "-"} />
          <FieldCard label="Role" value={user.role ?? "user"} badge />
          <FieldCard label="Status" value={user.banned ? "Banned" : "Active"} badge destructive={user.banned} />
          <FieldCard label="Email verified" value={user.emailVerified ? "Verified" : "Pending"} badge />
          <FieldCard label="Created" value={formatDateTime(user.createdAt)} />
          <FieldCard label="Updated" value={formatDateTime(user.updatedAt)} />
          <FieldCard label="Ban reason" value={user.banReason ?? "-"} />
          <FieldCard label="Ban expires" value={formatDateTime(user.banExpires)} />
        </TabsContent>

        <TabsContent value="sessions" className="space-y-4">
          {sessionsQuery.error ? (
            <Alert variant="destructive">
              <AlertCircle className="size-4" />
              <AlertTitle>Could not load sessions</AlertTitle>
              <AlertDescription>{getErrorMessage(sessionsQuery.error)}</AlertDescription>
            </Alert>
          ) : null}
          <DataTable
            columns={sessionColumns}
            data={sessionsQuery.data?.items ?? []}
            loading={sessionsQuery.isLoading}
            emptyMessage="No active sessions for this user."
          />
        </TabsContent>

        <TabsContent value="accounts" className="space-y-3">
          {user.accounts.length === 0 ? (
            <EmptyPanel message="No linked accounts found." />
          ) : (
            user.accounts.map((account) => (
              <InfoRow
                key={account.id}
                title={account.providerId ?? "Unknown provider"}
                subtitle={account.accountId ?? "No account identifier"}
                meta={`Created ${formatDateTime(account.createdAt)}`}
              />
            ))
          )}
        </TabsContent>

        <TabsContent value="2fa">
          <div className="rounded-xl border bg-card p-6">
            <p className="text-sm text-muted-foreground">Two-factor authentication status</p>
            <div className="mt-4 flex items-center gap-3">
              <Badge variant={twoFactorEnabled ? "default" : "outline"}>
                {twoFactorEnabled ? "Enabled" : "Disabled"}
              </Badge>
              <span className="text-sm text-muted-foreground">
                {user.twoFactor.length} record{user.twoFactor.length === 1 ? "" : "s"}
              </span>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="passkeys" className="space-y-3">
          {user.passkeys.length === 0 ? (
            <EmptyPanel message="No passkeys registered." />
          ) : (
            user.passkeys.map((passkey) => (
              <InfoRow
                key={passkey.id}
                title={passkey.name ?? passkey.deviceType ?? "Unnamed passkey"}
                subtitle={passkey.credentialID ?? "No credential id"}
                meta={`Created ${formatDateTime(passkey.createdAt)}`}
                badge={passkey.backedUp ? "Backed up" : "Not backed up"}
              />
            ))
          )}
        </TabsContent>

        <TabsContent value="audit" className="space-y-4">
          {auditQuery.error ? (
            <Alert variant="destructive">
              <AlertCircle className="size-4" />
              <AlertTitle>Could not load audit history</AlertTitle>
              <AlertDescription>{getErrorMessage(auditQuery.error)}</AlertDescription>
            </Alert>
          ) : null}
          <DataTable
            columns={auditColumns}
            data={auditQuery.data?.items ?? []}
            loading={auditQuery.isLoading}
            emptyMessage="No audit rows for this user yet."
            cursor={{
              next: auditQuery.data?.nextCursor ?? undefined,
              hasPrev: auditCursorStack.length > 0,
              onNext: () => {
                const nextCursor = auditQuery.data?.nextCursor;
                if (!nextCursor) return;
                setAuditCursorStack((current) => [...current, nextCursor]);
              },
              onPrev: () => {
                setAuditCursorStack((current) => current.slice(0, -1));
              },
            }}
          />
        </TabsContent>
      </Tabs>

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
          await revokeSessionMutation.mutateAsync(selectedSession);
          setSelectedSession(null);
        }}
      />
    </div>
  );
}

function FieldCard({
  label,
  value,
  badge = false,
  destructive = false,
}: {
  label: string;
  value: string;
  badge?: boolean;
  destructive?: boolean;
}) {
  return (
    <div className="rounded-xl border bg-card p-5">
      <p className="text-sm text-muted-foreground">{label}</p>
      <div className="mt-3">
        {badge ? (
          <Badge variant={destructive ? "destructive" : "outline"}>{value}</Badge>
        ) : (
          <p className="font-medium">{value}</p>
        )}
      </div>
    </div>
  );
}

function InfoRow({
  title,
  subtitle,
  meta,
  badge,
}: {
  title: string;
  subtitle: string;
  meta: string;
  badge?: string;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border bg-card p-5 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="font-medium">{title}</p>
        <p className="text-sm text-muted-foreground">{subtitle}</p>
      </div>
      <div className="flex items-center gap-3">
        {badge ? <Badge variant="outline">{badge}</Badge> : null}
        <span className="text-sm text-muted-foreground">{meta}</span>
      </div>
    </div>
  );
}

function EmptyPanel({ message }: { message: string }) {
  return <div className="rounded-xl border border-dashed bg-card/60 p-8 text-center text-sm text-muted-foreground">{message}</div>;
}
