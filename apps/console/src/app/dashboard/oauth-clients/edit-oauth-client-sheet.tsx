"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useState } from "react";
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
  getOAuthClientFormValuesFromClient,
  oauthClientFormSchema,
  OauthClientFormFields,
  type OAuthClientFormValues,
} from "./oauth-client-form";
import type { OAuthClient } from "./types";

type EditOauthClientSheetProps = {
  client: OAuthClient | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdated: () => Promise<void>;
};

export function EditOauthClientSheet({
  client,
  open,
  onOpenChange,
  onUpdated,
}: EditOauthClientSheetProps) {
  const form = useForm<OAuthClientFormValues>({
    resolver: zodResolver(oauthClientFormSchema),
    defaultValues: client ? getOAuthClientFormValuesFromClient(client) : undefined,
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (client) {
      form.reset(getOAuthClientFormValuesFromClient(client));
    }
  }, [client, form]);

  async function onSubmit(values: OAuthClientFormValues) {
    if (!client) {
      return;
    }

    try {
      setIsSubmitting(true);
      const payload = buildOAuthClientPayload(values);

      await fetchJson(`/api/admin/oauth-clients/${client.id}`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      toast.success("OAuth client updated.");
      onOpenChange(false);
      await onUpdated();
    } catch (error) {
      toast.error(getErrorMessage(error, "Failed to update the OAuth client."));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="overflow-y-auto sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>Edit OAuth client</SheetTitle>
          <SheetDescription>
            Update OAuth client metadata through the admin BFF.
          </SheetDescription>
        </SheetHeader>

        {client ? (
          <Form {...form}>
            <form
              className="grid gap-6 px-4 pb-4"
              onSubmit={form.handleSubmit((values) => void onSubmit(values))}
            >
              <OauthClientFormFields form={form} clientId={client.clientId} />
              <SheetFooter className="px-0 pb-0">
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={isSubmitting}>
                  Save changes
                </Button>
              </SheetFooter>
            </form>
          </Form>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
