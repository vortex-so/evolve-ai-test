"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  AlertCircle,
  MoreHorizontal,
  Search,
} from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@vortex/ui/components/alert";
import { Avatar, AvatarFallback, AvatarImage } from "@vortex/ui/components/avatar";
import { Badge } from "@vortex/ui/components/badge";
import { Button } from "@vortex/ui/components/button";
import { ConfirmDialog } from "@vortex/ui/components/confirm-dialog";
import { DataTable } from "@vortex/ui/components/data-table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@vortex/ui/components/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@vortex/ui/components/dropdown-menu";
import { Input } from "@vortex/ui/components/input";
import { Label } from "@vortex/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@vortex/ui/components/select";

import { fetchJsonOrThrow, mutateOrThrow } from "@/lib/admin-client";
import {
  filterAdminUsers,
  formatUserDisplayName,
  getErrorMessage,
  normalizeAdminUsersResponse,
  type AdminUser,
} from "@/lib/admin-types";

type UsersTableProps = {
  initialUsers: AdminUser[];
  initialSearch: string;
  initialError?: string;
};

type BanFormState = {
  reason: string;
  duration: "1d" | "7d" | "30d" | "permanent";
};

type DialogState =
  | { type: "ban"; user: AdminUser }
  | { type: "revoke-all"; user: AdminUser }
  | { type: "remove"; user: AdminUser }
  | { type: "role"; user: AdminUser }
  | { type: "password"; user: AdminUser }
  | null;

const DURATION_TO_SECONDS: Record<BanFormState["duration"], number | undefined> = {
  "1d": 86_400,
  "7d": 604_800,
  "30d": 2_592_000,
  permanent: undefined,
};

function getInitials(user: AdminUser): string {
  const source = formatUserDisplayName(user).trim();
  if (!source) {
    return "U";
  }

  return source
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "U";
}

export function UsersTable({ initialUsers, initialSearch, initialError }: UsersTableProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const [isRouting, startRouting] = useTransition();

  const urlSearch = searchParams.get("search") ?? initialSearch;
  const [searchValue, setSearchValue] = useState(urlSearch);
  const [dialogState, setDialogState] = useState<DialogState>(null);
  const [banForm, setBanForm] = useState<BanFormState>({ reason: "", duration: "7d" });
  const [roleValue, setRoleValue] = useState<"user" | "admin">("user");
  const [passwordValue, setPasswordValue] = useState("");

  useEffect(() => {
    setSearchValue(urlSearch);
  }, [urlSearch]);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      if (searchValue === urlSearch) {
        return;
      }

      const next = new URLSearchParams(searchParams.toString());
      if (searchValue.trim()) {
        next.set("search", searchValue.trim());
      } else {
        next.delete("search");
      }

      startRouting(() => {
        const query = next.toString();
        router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
      });
    }, 250);

    return () => window.clearTimeout(handle);
  }, [pathname, router, searchParams, searchValue, urlSearch]);

  const usersQuery = useQuery({
    queryKey: ["admin-users"],
    queryFn: async () => normalizeAdminUsersResponse(await fetchJsonOrThrow<unknown>("/api/admin/users")),
    initialData: { items: initialUsers, nextCursor: null, total: initialUsers.length },
  });

  const filteredUsers = useMemo(
    () => filterAdminUsers(usersQuery.data.items, urlSearch),
    [usersQuery.data.items, urlSearch]
  );

  const refreshUsers = async (successMessage: string, mutation: () => Promise<void>) => {
    try {
      await mutation();
      await queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      toast.success(successMessage);
    } catch (error) {
      toast.error(getErrorMessage(error));
      throw error;
    }
  };

  const unbanMutation = useMutation({
    mutationFn: async (user: AdminUser) => {
      await refreshUsers(`Unbanned ${formatUserDisplayName(user)}.`, async () => {
        await mutateOrThrow(`/api/admin/users/${user.id}/unban`, { method: "POST" });
      });
    },
  });

  const impersonateMutation = useMutation({
    mutationFn: async (user: AdminUser) => {
      await mutateOrThrow(`/api/admin/users/${user.id}/impersonate`, { method: "POST" });
      toast.success(`Impersonating ${formatUserDisplayName(user)}.`);
      window.location.href = "https://auth.auth-dev.vortex.so";
    },
    onError: (error) => {
      toast.error(getErrorMessage(error));
    },
  });

  const roleMutation = useMutation({
    mutationFn: async ({ user, role }: { user: AdminUser; role: "user" | "admin" }) => {
      await refreshUsers(`Updated role for ${formatUserDisplayName(user)}.`, async () => {
        await mutateOrThrow(`/api/admin/users/${user.id}/role`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ role }),
        });
      });
    },
  });

  const passwordMutation = useMutation({
    mutationFn: async ({ user, password }: { user: AdminUser; password: string }) => {
      await refreshUsers(`Password updated for ${formatUserDisplayName(user)}.`, async () => {
        await mutateOrThrow(`/api/admin/users/${user.id}/password`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ newPassword: password }),
        });
      });
    },
  });

  const columns: ColumnDef<AdminUser>[] = [
    {
      accessorKey: "name",
      header: "Avatar",
      cell: ({ row }) => {
        const user = row.original;
        return (
          <div className="flex items-center gap-3">
            <Avatar>
              <AvatarImage src={user.image ?? undefined} alt={formatUserDisplayName(user)} />
              <AvatarFallback>{getInitials(user)}</AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <p className="truncate font-medium">{formatUserDisplayName(user)}</p>
              <p className="truncate text-xs text-muted-foreground">{user.id}</p>
            </div>
          </div>
        );
      },
    },
    {
      accessorKey: "email",
      header: "Email",
      cell: ({ row }) => row.original.email ?? "-",
    },
    {
      accessorKey: "role",
      header: "Role",
      cell: ({ row }) => (
        <Badge variant={row.original.role === "admin" ? "default" : "secondary"}>
          {row.original.role ?? "user"}
        </Badge>
      ),
    },
    {
      accessorKey: "banned",
      header: "Status",
      cell: ({ row }) => (
        <Badge variant={row.original.banned ? "destructive" : "outline"}>
          {row.original.banned ? "Banned" : "Active"}
        </Badge>
      ),
    },
    {
      id: "actions",
      header: "Actions",
      cell: ({ row }) => {
        const user = row.original;
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label={`Open actions for ${formatUserDisplayName(user)}`}>
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild>
                <Link href={`/dashboard/users/${user.id}`}>View</Link>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  setRoleValue((user.role as "user" | "admin") ?? "user");
                  setDialogState({ type: "role", user });
                }}
              >
                Set role
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  setPasswordValue("");
                  setDialogState({ type: "password", user });
                }}
              >
                Set password
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => impersonateMutation.mutate(user)}>
                Impersonate
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {user.banned ? (
                <DropdownMenuItem onClick={() => unbanMutation.mutate(user)}>Unban</DropdownMenuItem>
              ) : (
                <DropdownMenuItem
                  onClick={() => {
                    setBanForm({ reason: user.banReason ?? "", duration: "7d" });
                    setDialogState({ type: "ban", user });
                  }}
                >
                  Ban
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={() => setDialogState({ type: "revoke-all", user })}>
                Revoke all sessions
              </DropdownMenuItem>
              <DropdownMenuItem variant="destructive" onClick={() => setDialogState({ type: "remove", user })}>
                Remove user
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    },
  ];

  const tableError = usersQuery.error
    ? getErrorMessage(usersQuery.error)
    : usersQuery.data.items.length > 0
      ? undefined
      : initialError;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold">Users</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Manage roles, bans, passwords, impersonation, and session revocation.
        </p>
      </div>

      {tableError ? (
        <Alert variant="destructive">
          <AlertCircle className="size-4" />
          <AlertTitle>Users request failed</AlertTitle>
          <AlertDescription>{tableError}</AlertDescription>
        </Alert>
      ) : null}

      <DataTable
        columns={columns}
        data={filteredUsers}
        loading={usersQuery.isFetching && !usersQuery.data.items.length}
        emptyMessage={urlSearch ? "No users match this search." : "No users found."}
        filterInput={
          <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative w-full max-w-sm">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={searchValue}
                onChange={(event) => setSearchValue(event.target.value)}
                placeholder="Search by name or email"
                className="pl-9"
              />
            </div>
            <div className="text-sm text-muted-foreground">
              {isRouting ? "Updating filter..." : `${filteredUsers.length} result${filteredUsers.length === 1 ? "" : "s"}`}
            </div>
          </div>
        }
      />

      <ConfirmDialog
        open={dialogState?.type === "ban"}
        onOpenChange={(open) => {
          if (!open) setDialogState(null);
        }}
        title={dialogState?.type === "ban" ? `Ban ${formatUserDisplayName(dialogState.user)}?` : "Ban user"}
        description={
          dialogState?.type === "ban" ? (
            <div className="space-y-4 pt-3 text-left">
              <div className="space-y-2">
                <Label htmlFor="ban-reason">Reason</Label>
                <Input
                  id="ban-reason"
                  value={banForm.reason}
                  onChange={(event) => setBanForm((current) => ({ ...current, reason: event.target.value }))}
                  placeholder="Optional reason"
                />
              </div>
              <div className="space-y-2">
                <Label>Duration</Label>
                <Select
                  value={banForm.duration}
                  onValueChange={(value) =>
                    setBanForm((current) => ({
                      ...current,
                      duration: value as BanFormState["duration"],
                    }))
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select duration" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1d">1 day</SelectItem>
                    <SelectItem value="7d">7 days</SelectItem>
                    <SelectItem value="30d">30 days</SelectItem>
                    <SelectItem value="permanent">Permanent</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          ) : (
            ""
          )
        }
        confirmLabel="Ban user"
        variant="destructive"
        onConfirm={async () => {
          if (dialogState?.type !== "ban") return;

          await refreshUsers(`Banned ${formatUserDisplayName(dialogState.user)}.`, async () => {
            await mutateOrThrow(`/api/admin/users/${dialogState.user.id}/ban`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                banReason: banForm.reason || undefined,
                banExpiresIn: DURATION_TO_SECONDS[banForm.duration],
              }),
            });
          });
          setDialogState(null);
        }}
      />

      <ConfirmDialog
        open={dialogState?.type === "revoke-all"}
        onOpenChange={(open) => {
          if (!open) setDialogState(null);
        }}
        title={dialogState?.type === "revoke-all" ? `Revoke all sessions for ${formatUserDisplayName(dialogState.user)}?` : "Revoke sessions"}
        description="This signs the user out everywhere immediately."
        confirmLabel="Revoke sessions"
        variant="destructive"
        onConfirm={async () => {
          if (dialogState?.type !== "revoke-all") return;

          await refreshUsers(`Revoked all sessions for ${formatUserDisplayName(dialogState.user)}.`, async () => {
            await mutateOrThrow(`/api/admin/users/${dialogState.user.id}/sessions`, { method: "DELETE" });
          });
          setDialogState(null);
        }}
      />

      <ConfirmDialog
        open={dialogState?.type === "remove"}
        onOpenChange={(open) => {
          if (!open) setDialogState(null);
        }}
        title={dialogState?.type === "remove" ? `Remove ${formatUserDisplayName(dialogState.user)}?` : "Remove user"}
        description="This permanently removes the user account from Better Auth."
        confirmLabel="Remove user"
        variant="destructive"
        onConfirm={async () => {
          if (dialogState?.type !== "remove") return;

          await refreshUsers(`Removed ${formatUserDisplayName(dialogState.user)}.`, async () => {
            await mutateOrThrow(`/api/admin/users/${dialogState.user.id}`, { method: "DELETE" });
          });
          setDialogState(null);
        }}
      />

      <Dialog
        open={dialogState?.type === "role"}
        onOpenChange={(open) => {
          if (!open) setDialogState(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Set role</DialogTitle>
            <DialogDescription>
              Update the role for {dialogState?.type === "role" ? formatUserDisplayName(dialogState.user) : "this user"}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Role</Label>
            <Select value={roleValue} onValueChange={(value) => setRoleValue(value as "user" | "admin")}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select role" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="user">User</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogState(null)}>
              Cancel
            </Button>
            <Button
              onClick={async () => {
                if (dialogState?.type !== "role") return;
                await roleMutation.mutateAsync({ user: dialogState.user, role: roleValue });
                setDialogState(null);
              }}
              disabled={roleMutation.isPending}
            >
              {roleMutation.isPending ? "Saving..." : "Save role"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={dialogState?.type === "password"}
        onOpenChange={(open) => {
          if (!open) setDialogState(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Set password</DialogTitle>
            <DialogDescription>
              Set a new password for {dialogState?.type === "password" ? formatUserDisplayName(dialogState.user) : "this user"}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="new-password">New password</Label>
            <Input
              id="new-password"
              type="text"
              value={passwordValue}
              onChange={(event) => setPasswordValue(event.target.value)}
              placeholder="Enter a temporary password"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogState(null)}>
              Cancel
            </Button>
            <Button
              onClick={async () => {
                if (dialogState?.type !== "password" || !passwordValue.trim()) {
                  toast.error("Password is required.");
                  return;
                }

                await passwordMutation.mutateAsync({ user: dialogState.user, password: passwordValue.trim() });
                setDialogState(null);
              }}
              disabled={passwordMutation.isPending}
            >
              {passwordMutation.isPending ? "Saving..." : "Save password"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
