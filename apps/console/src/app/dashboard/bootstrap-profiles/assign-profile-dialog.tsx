"use client";

import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@vortex/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@vortex/ui/components/dialog";
import { Input } from "@vortex/ui/components/input";

import type { BootstrapProfileRecord } from "./bootstrap-profiles-table";

type AssignProfileDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  profile: BootstrapProfileRecord | null;
};

export function AssignProfileDialog({
  open,
  onOpenChange,
  profile,
}: AssignProfileDialogProps) {
  const [userId, setUserId] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setUserId("");
    }
  }, [open]);

  async function handleAssign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!profile) {
      return;
    }

    const trimmedUserId = userId.trim();
    if (!trimmedUserId) {
      toast.error("User ID is required");
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch(`/api/admin/bootstrap-assignments/${trimmedUserId}`, {
        method: "PUT",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ profile_id: profile.id }),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(body?.error ?? `Request failed with status ${response.status}`);
      }

      toast.success("Profile assigned to user");
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to assign profile");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Assign profile to user</DialogTitle>
          <DialogDescription>
            Attach <span className="font-medium">{profile?.name ?? "this profile"}</span> to a user by ID.
          </DialogDescription>
        </DialogHeader>

        <form className="space-y-4" onSubmit={handleAssign}>
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="assign-user-id">
              User ID
            </label>
            <Input
              id="assign-user-id"
              className="font-mono"
              placeholder="user_123"
              value={userId}
              onChange={(event) => setUserId(event.target.value)}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Assigning..." : "Assign profile"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
