"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { Button } from "@vortex/ui/components/button";
import { Form } from "@vortex/ui/components/form";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@vortex/ui/components/sheet";

import { fetchJson, getErrorMessage } from "@/lib/fetch-json";

import {
  buildOAuthClientPayload,
  getDefaultOAuthClientFormValues,
  oauthClientFormSchema,
  OauthClientFormFields,
  type OAuthClientFormValues,
} from "./oauth-client-form";
import { SecretRevealDialog } from "./secret-reveal-dialog";
import { extractClientSecret, normalizeOAuthClient } from "./types";

type CreateOauthClientSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => Promise<void>;
};

export function CreateOauthClientSheet({
  open,
  onOpenChange,
  onCreated,
}: CreateOauthClientSheetProps) {
  const form = useForm<OAuthClientFormValues>({
    resolver: zodResolver(oauthClientFormSchema),
    defaultValues: getDefaultOAuthClientFormValues(),
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [revealedSecret, setRevealedSecret] = useState<string | null>(null);
  const [revealedClientId, setRevealedClientId] = useState<string | undefined>(undefined);
  const [isSecretDialogOpen, setIsSecretDialogOpen] = useState(false);

  async function onSubmit(values: OAuthClientFormValues) {
    try {
      setIsSubmitting(true);
      const payload = buildOAuthClientPayload(values);
      const response = await fetchJson<unknown>("/api/admin/oauth-clients", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const secret = extractClientSecret(response);
      const createdClient = normalizeOAuthClient(response);

      toast.success("OAuth client created.");
      form.reset(getDefaultOAuthClientFormValues());
      onOpenChange(false);
      await onCreated();

      if (secret) {
        setRevealedSecret(secret);
        setRevealedClientId(createdClient.clientId || undefined);
        setIsSecretDialogOpen(true);
      }
    } catch (error) {
      toast.error(getErrorMessage(error, "Failed to create the OAuth client."));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <>
      <Sheet
        open={open}
        onOpenChange={(nextOpen) => {
          onOpenChange(nextOpen);
          if (!nextOpen) {
            form.reset(getDefaultOAuthClientFormValues());
          }
        }}
      >
        <SheetContent className="overflow-y-auto sm:max-w-2xl">
          <SheetHeader>
            <SheetTitle>New OAuth client</SheetTitle>
            <SheetDescription>
              Create a new OAuth client through the admin BFF.
            </SheetDescription>
          </SheetHeader>

          <Form {...form}>
            <form
              className="grid gap-6 px-4 pb-4"
              onSubmit={form.handleSubmit((values) => void onSubmit(values))}
            >
              <OauthClientFormFields form={form} />
              <SheetFooter className="px-0 pb-0">
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={isSubmitting}>
                  Create client
                </Button>
              </SheetFooter>
            </form>
          </Form>
        </SheetContent>
      </Sheet>

      <SecretRevealDialog
        open={isSecretDialogOpen}
        onOpenChange={setIsSecretDialogOpen}
        secret={revealedSecret}
        clientId={revealedClientId}
        title="Client secret created"
        description="This is the only time the new client secret will be shown. Copy it somewhere secure now."
      />
    </>
  );
}
