"use client";

import type { FormEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@vortex/ui/components/badge";
import { Button } from "@vortex/ui/components/button";
import { Checkbox } from "@vortex/ui/components/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@vortex/ui/components/dialog";
import { Input } from "@vortex/ui/components/input";

import { mutateOrThrow } from "@/lib/admin-client";
import {
  filterAdminUsers,
  formatUserDisplayName,
  getErrorMessage,
  type AdminUser,
} from "@/lib/admin-types";

import type { BootstrapProfileRecord } from "./bootstrap-profiles-table";

type AssignProfileDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  profile: BootstrapProfileRecord | null;
  profiles: BootstrapProfileRecord[];
  users: AdminUser[];
  assignments: Record<string, string>;
  loading: boolean;
  error?: string;
  onAssigned: () => void;
};

function pluralUsers(count: number): string {
  return `${count} user${count === 1 ? "" : "s"}`;
}

export function AssignProfileDialog({
  open,
  onOpenChange,
  profile,
  profiles,
  users,
  assignments,
  loading,
  error,
  onAssigned,
}: AssignProfileDialogProps) {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [assignedNow, setAssignedNow] = useState<Set<string>>(() => new Set());
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setSearch("");
      setSelected(new Set());
      setAssignedNow(new Set());
    }
  }, [open, profile?.id]);

  const profileNames = useMemo(
    () => new Map(profiles.map((entry) => [entry.id, entry.name])),
    [profiles],
  );
  const visibleUsers = useMemo(() => filterAdminUsers(users, search), [users, search]);

  function isInThisProfile(userId: string): boolean {
    return assignedNow.has(userId) || (profile !== null && assignments[userId] === profile.id);
  }

  const selectableVisible = visibleUsers.filter((user) => !isInThisProfile(user.id));
  const allVisibleSelected =
    selectableVisible.length > 0 && selectableVisible.every((user) => selected.has(user.id));

  function toggleUser(userId: string, checked: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(userId);
      else next.delete(userId);
      return next;
    });
  }

  function toggleAllVisible() {
    setSelected((current) => {
      const next = new Set(current);
      for (const user of selectableVisible) {
        if (allVisibleSelected) next.delete(user.id);
        else next.add(user.id);
      }
      return next;
    });
  }

  async function handleAssign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!profile || selected.size === 0) {
      return;
    }

    setIsSubmitting(true);
    const targets = users.filter((user) => selected.has(user.id));
    const succeeded: string[] = [];
    const failures: Array<{ user: AdminUser; message: string }> = [];

    for (const user of targets) {
      try {
        await mutateOrThrow(`/api/admin/bootstrap-assignments/${encodeURIComponent(user.id)}`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ profile_id: profile.id }),
        });
        succeeded.push(user.id);
      } catch (assignError) {
        failures.push({ user, message: getErrorMessage(assignError) });
      }
    }

    setIsSubmitting(false);
    if (succeeded.length > 0) {
      onAssigned();
    }

    if (failures.length === 0) {
      toast.success(`Assigned ${pluralUsers(succeeded.length)} to ${profile.name}.`);
      onOpenChange(false);
      return;
    }

    setAssignedNow((current) => new Set([...current, ...succeeded]));
    setSelected(new Set(failures.map(({ user }) => user.id)));
    toast.error(
      `Assigned ${succeeded.length} of ${pluralUsers(targets.length)}. Failed: ${failures
        .map(({ user, message }) => `${formatUserDisplayName(user)} (${message})`)
        .join(", ")}`,
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Assign users to {profile?.name ?? "profile"}</DialogTitle>
          <DialogDescription>
            Pick users by name or email. Users on another profile move to this one.
          </DialogDescription>
        </DialogHeader>

        <form className="space-y-4" onSubmit={handleAssign}>
          <div className="flex items-center gap-2">
            <Input
              aria-label="Search users"
              placeholder="Search by name or email"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <Button
              type="button"
              variant="outline"
              className="shrink-0"
              disabled={selectableVisible.length === 0 || isSubmitting}
              onClick={toggleAllVisible}
            >
              {allVisibleSelected ? "Clear shown" : "Select shown"}
            </Button>
          </div>

          <div className="max-h-72 overflow-y-auto rounded-md border">
            {loading ? (
              <p className="p-3 text-sm text-muted-foreground">Loading users...</p>
            ) : error ? (
              <p className="p-3 text-sm text-destructive">{error}</p>
            ) : visibleUsers.length === 0 ? (
              <p className="p-3 text-sm text-muted-foreground">
                {search.trim() ? "No users match this search." : "No users found."}
              </p>
            ) : (
              <ul className="divide-y">
                {visibleUsers.map((user) => {
                  const name = formatUserDisplayName(user);
                  const inThisProfile = isInThisProfile(user.id);
                  const currentProfileId = assignments[user.id];
                  const badge = inThisProfile
                    ? `Already in ${profile?.name ?? "this profile"}`
                    : currentProfileId
                      ? (profileNames.get(currentProfileId) ?? "Other profile")
                      : "No profile";

                  return (
                    <li key={user.id}>
                      <label className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-muted/50">
                        <Checkbox
                          aria-label={name}
                          checked={inThisProfile || selected.has(user.id)}
                          disabled={inThisProfile || isSubmitting}
                          onCheckedChange={(value) => toggleUser(user.id, value === true)}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{name}</span>
                          {user.email && user.email !== name ? (
                            <span className="block truncate text-xs text-muted-foreground">
                              {user.email}
                            </span>
                          ) : null}
                        </span>
                        <Badge
                          variant={inThisProfile ? "secondary" : "outline"}
                          className="max-w-[45%] shrink-0 truncate"
                        >
                          {badge}
                        </Badge>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <DialogFooter className="items-center">
            <p className="text-sm text-muted-foreground sm:mr-auto">{selected.size} selected</p>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting || selected.size === 0}>
              {isSubmitting ? "Assigning..." : `Assign ${pluralUsers(selected.size)}`}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
