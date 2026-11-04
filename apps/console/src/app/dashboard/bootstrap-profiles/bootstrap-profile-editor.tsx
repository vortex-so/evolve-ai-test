"use client";

import type { FormEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@vortex/ui/components/alert";
import { Button } from "@vortex/ui/components/button";
import { Input } from "@vortex/ui/components/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@vortex/ui/components/sheet";
import { Switch } from "@vortex/ui/components/switch";
import { Textarea } from "@vortex/ui/components/textarea";

import { validateBootstrapConfigHint } from "./bootstrap-config-hint-schema";
import type { BootstrapProfileRecord } from "./bootstrap-profiles-table";

type BootstrapProfileEditorProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  profile: BootstrapProfileRecord | null;
  existingNames: string[];
  onSaved: () => Promise<void>;
};

type InlineError = {
  path: string;
  message: string;
};

function getInitialConfig(profile: BootstrapProfileRecord | null): string {
  return JSON.stringify(profile?.config ?? {}, null, 2);
}

export function BootstrapProfileEditor({
  open,
  onOpenChange,
  profile,
  existingNames,
  onSaved,
}: BootstrapProfileEditorProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [config, setConfig] = useState("{}");
  const [isDefault, setIsDefault] = useState(false);
  const [errors, setErrors] = useState<InlineError[]>([]);
  const [nameError, setNameError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!open) {
      return;
    }

    setName(profile?.name ?? "");
    setDescription(profile?.description ?? "");
    setConfig(getInitialConfig(profile));
    setIsDefault(Boolean(profile?.is_default));
    setErrors([]);
    setNameError(null);
  }, [open, profile]);

  const duplicateName = useMemo(() => {
    const normalizedName = name.trim().toLowerCase();
    if (!normalizedName) {
      return false;
    }

    return existingNames.some((existingName) => {
      if (profile && existingName.trim().toLowerCase() === profile.name.trim().toLowerCase()) {
        return false;
      }
      return existingName.trim().toLowerCase() === normalizedName;
    });
  }, [existingNames, name, profile]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmedName = name.trim();
    if (!trimmedName) {
      setNameError("Name is required.");
      return;
    }

    if (duplicateName) {
      setNameError("Profile name must be unique.");
      return;
    }

    setNameError(null);
    setErrors([]);

    let parsedConfig: unknown;
    try {
      parsedConfig = JSON.parse(config);
    } catch (error) {
      setErrors([
        {
          path: "$",
          message:
            error instanceof Error ? error.message : "Config must be valid JSON.",
        },
      ]);
      return;
    }

    const hintErrors = validateBootstrapConfigHint(parsedConfig);
    if (hintErrors.length > 0) {
      setErrors(hintErrors);
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch(
        profile
          ? `/api/admin/bootstrap-profiles/${profile.id}`
          : "/api/admin/bootstrap-profiles",
        {
          method: profile ? "PATCH" : "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            name: trimmedName,
            description: description.trim() || null,
            config: parsedConfig,
            is_default: isDefault,
          }),
        },
      );

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as
          | { error?: string; code?: string; errors?: InlineError[] }
          | null;

        if (response.status === 400 && body?.error === "invalid_bootstrap_config") {
          setErrors(body.errors ?? []);
          return;
        }

        throw new Error(body?.error ?? `Request failed with status ${response.status}`);
      }

      toast.success(profile ? "Profile updated" : "Profile created");
      await onSaved();
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save profile");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-3xl">
        <SheetHeader>
          <SheetTitle>{profile ? "Edit profile" : "New profile"}</SheetTitle>
          <SheetDescription>
            Configure the bootstrap JSON that will be validated again on the server.
          </SheetDescription>
        </SheetHeader>

        <form className="flex min-h-0 flex-1 flex-col gap-4 px-4 pb-4" onSubmit={handleSubmit}>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="profile-name">
                Name
              </label>
              <Input
                id="profile-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                aria-invalid={nameError ? true : undefined}
              />
              {nameError ? <p className="text-sm text-destructive">{nameError}</p> : null}
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="profile-description">
                Description
              </label>
              <Input
                id="profile-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </div>
          </div>

          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <p className="text-sm font-medium">Default profile</p>
              <p className="text-xs text-muted-foreground">
                New users inherit this when they do not have an explicit assignment.
              </p>
            </div>
            <Switch checked={isDefault} onCheckedChange={setIsDefault} />
          </div>

          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="text-sm font-medium">Config JSON</p>
              <p className="text-xs text-muted-foreground">
                Client-side validation is only a hint. Server-side Zod validation is the source of truth.
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  try {
                    setConfig(JSON.stringify(JSON.parse(config), null, 2));
                    setErrors([]);
                  } catch (error) {
                    setErrors([
                      {
                        path: "$",
                        message:
                          error instanceof Error
                            ? error.message
                            : "Config must be valid JSON.",
                      },
                    ]);
                  }
                }}
              >
                Pretty-print
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  try {
                    setConfig(JSON.stringify(JSON.parse(config)));
                    setErrors([]);
                  } catch (error) {
                    setErrors([
                      {
                        path: "$",
                        message:
                          error instanceof Error
                            ? error.message
                            : "Config must be valid JSON.",
                      },
                    ]);
                  }
                }}
              >
                Minify
              </Button>
            </div>
          </div>

          <Textarea
            value={config}
            onChange={(event) => setConfig(event.target.value)}
            className="min-h-[420px] flex-1 font-mono text-xs"
            aria-invalid={errors.length > 0 ? true : undefined}
          />

          {errors.length > 0 ? (
            <Alert variant="destructive">
              <AlertDescription>
                <div className="space-y-1">
                  {errors.map((error) => (
                    <p key={`${error.path}:${error.message}`}>
                      <span className="font-mono">{error.path || "$"}</span>: {error.message}
                    </p>
                  ))}
                </div>
              </AlertDescription>
            </Alert>
          ) : null}

          <SheetFooter className="px-0">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Saving..." : profile ? "Save changes" : "Create profile"}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
