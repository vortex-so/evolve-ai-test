"use client";

import { useState } from "react";
import { CopyIcon } from "lucide-react";
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

type SecretRevealDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  secret: string | null;
  clientId?: string;
  title: string;
  description: string;
};

export function SecretRevealDialog({
  open,
  onOpenChange,
  secret,
  clientId,
  title,
  description,
}: SecretRevealDialogProps) {
  const [isCopying, setIsCopying] = useState(false);

  async function copySecret() {
    if (!secret) {
      return;
    }

    try {
      setIsCopying(true);
      await navigator.clipboard.writeText(secret);
      toast.success("Client secret copied to clipboard.");
    } catch {
      toast.error("Failed to copy the client secret.");
    } finally {
      setIsCopying(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          {clientId ? (
            <div className="grid gap-1">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Client ID
              </p>
              <code className="rounded-md border bg-muted px-3 py-2 text-sm">{clientId}</code>
            </div>
          ) : null}
          <div className="grid gap-1">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Client secret
            </p>
            <code className="break-all rounded-md border bg-muted px-3 py-2 text-sm">
              {secret ?? "No client secret was returned by the server."}
            </code>
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Close
          </Button>
          <Button type="button" onClick={() => void copySecret()} disabled={!secret || isCopying}>
            <CopyIcon className="size-4" />
            Copy to clipboard
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
