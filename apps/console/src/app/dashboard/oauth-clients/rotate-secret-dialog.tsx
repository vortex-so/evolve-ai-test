"use client";

import { useState } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { fetchJson, getErrorMessage } from "@/lib/fetch-json";

import { SecretRevealDialog } from "./secret-reveal-dialog";
import { extractClientSecret, type OAuthClient } from "./types";

type RotateSecretDialogProps = {
  client: OAuthClient | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRotated: () => Promise<void>;
};

export function RotateSecretDialog({
  client,
  open,
  onOpenChange,
  onRotated,
}: RotateSecretDialogProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [revealedSecret, setRevealedSecret] = useState<string | null>(null);
  const [isSecretDialogOpen, setIsSecretDialogOpen] = useState(false);

  async function rotateSecret() {
    if (!client) {
      return;
    }

    try {
      setIsSubmitting(true);
      const response = await fetchJson<unknown>(
        `/api/admin/oauth-clients/${client.id}/rotate-secret`,
        {
          method: "POST",
        },
      );

      const secret = extractClientSecret(response);
      toast.success("OAuth client secret rotated.");
      onOpenChange(false);
      await onRotated();

      if (secret) {
        setRevealedSecret(secret);
        setIsSecretDialogOpen(true);
      }
    } catch (error) {
      toast.error(getErrorMessage(error, "Failed to rotate the client secret."));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <>
      <ConfirmDialog
        open={open}
        onOpenChange={onOpenChange}
        title="Rotate client secret?"
        description="This invalidates the current secret. Any active clients using the old secret must update."
        confirmLabel="Rotate secret"
        isPending={isSubmitting}
        onConfirm={rotateSecret}
      />
      <SecretRevealDialog
        open={isSecretDialogOpen}
        onOpenChange={setIsSecretDialogOpen}
        secret={revealedSecret}
        clientId={client?.clientId}
        title="Client secret rotated"
        description="This is the only time the replacement client secret will be shown. Copy it somewhere secure now."
      />
    </>
  );
}
