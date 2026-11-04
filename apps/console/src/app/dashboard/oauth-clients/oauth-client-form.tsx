"use client";

import type { UseFormReturn } from "react-hook-form";
import { z } from "zod";

import { Checkbox } from "@vortex/ui/components/checkbox";
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@vortex/ui/components/form";
import { Input } from "@vortex/ui/components/input";
import { Label } from "@vortex/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@vortex/ui/components/select";
import { Switch } from "@vortex/ui/components/switch";
import { Textarea } from "@vortex/ui/components/textarea";

import {
  mapGrantTypeToApi,
  OAUTH_GRANT_TYPE_OPTIONS,
  OAUTH_RESPONSE_TYPE_OPTIONS,
  OAUTH_SCOPE_OPTIONS,
  type OAuthClient,
  TOKEN_ENDPOINT_AUTH_METHOD_OPTIONS,
} from "./types";

function optionalUrlSchema(label: string) {
  return z.string().trim().superRefine((value, ctx) => {
    if (!value) {
      return;
    }

    if (!URL.canParse(value)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${label} must be a valid URL.`,
      });
    }
  });
}

export const oauthClientFormSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required."),
    clientUri: optionalUrlSchema("Client URI"),
    logoUri: optionalUrlSchema("Logo URI"),
    redirectUrisText: z.string(),
    scopes: z.array(z.string()).min(1, "Select at least one scope."),
    grantTypes: z.array(z.string()).min(1, "Select at least one grant type."),
    responseTypes: z.array(z.string()).min(1, "Select at least one response type."),
    tokenEndpointAuthMethod: z.string().min(1, "Select a token endpoint auth method."),
    requirePKCE: z.boolean(),
  })
  .superRefine((value, ctx) => {
    const redirectUris = parseRedirectUrisText(value.redirectUrisText);
    if (value.grantTypes.includes("authorization_code") && redirectUris.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["redirectUrisText"],
        message: "At least one redirect URI is required for authorization_code clients.",
      });
    }
  });

export type OAuthClientFormValues = z.infer<typeof oauthClientFormSchema>;

export function parseRedirectUrisText(value: string): string[] {
  return value
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function getDefaultOAuthClientFormValues(): OAuthClientFormValues {
  return {
    name: "",
    clientUri: "",
    logoUri: "",
    redirectUrisText: "",
    scopes: ["openid", "profile", "email", "offline_access"],
    grantTypes: ["authorization_code", "refresh_token"],
    responseTypes: ["code"],
    tokenEndpointAuthMethod: "client_secret_basic",
    requirePKCE: true,
  };
}

export function getOAuthClientFormValuesFromClient(client: OAuthClient): OAuthClientFormValues {
  return {
    name: client.name,
    clientUri: client.uri,
    logoUri: client.logoUri,
    redirectUrisText: client.redirectUris.join(",\n"),
    scopes: client.scopes.length > 0 ? client.scopes : ["openid"],
    grantTypes: client.grantTypes.length > 0 ? client.grantTypes : ["authorization_code"],
    responseTypes: client.responseTypes.length > 0 ? client.responseTypes : ["code"],
    tokenEndpointAuthMethod: client.tokenEndpointAuthMethod || "client_secret_basic",
    requirePKCE: client.requirePKCE,
  };
}

export function buildOAuthClientPayload(values: OAuthClientFormValues): Record<string, unknown> {
  const redirectUris = parseRedirectUrisText(values.redirectUrisText);
  const grantTypes = values.grantTypes.map(mapGrantTypeToApi);
  const scopesText = values.scopes.join(" ");
  const clientUri = values.clientUri.trim();
  const logoUri = values.logoUri.trim();
  const isPublicClient = values.tokenEndpointAuthMethod === "none";

  return {
    name: values.name.trim(),
    client_name: values.name.trim(),
    uri: clientUri || null,
    client_uri: clientUri || null,
    logo_uri: logoUri || null,
    logoUri: logoUri || null,
    redirectUris,
    redirect_uris: redirectUris,
    scopes: values.scopes,
    scope: scopesText,
    grantTypes,
    grant_types: grantTypes,
    responseTypes: values.responseTypes,
    response_types: values.responseTypes,
    tokenEndpointAuthMethod: values.tokenEndpointAuthMethod,
    token_endpoint_auth_method: values.tokenEndpointAuthMethod,
    requirePKCE: values.requirePKCE,
    require_pkce: values.requirePKCE,
    public: isPublicClient,
    type: isPublicClient ? "public" : "confidential",
  };
}

type OauthClientFormFieldsProps = {
  form: UseFormReturn<OAuthClientFormValues>;
  clientId?: string;
};

function CheckboxGroupField({
  form,
  name,
  label,
  description,
  options,
}: {
  form: UseFormReturn<OAuthClientFormValues>;
  name: "scopes" | "grantTypes" | "responseTypes";
  label: string;
  description?: string;
  options: readonly string[];
}) {
  return (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          {description ? <FormDescription>{description}</FormDescription> : null}
          <div className="grid gap-2 rounded-md border p-3">
            {options.map((option) => {
              const checked = field.value.includes(option);

              return (
                <label key={option} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={checked}
                    onCheckedChange={(nextChecked) => {
                      const nextValues = nextChecked
                        ? [...field.value, option]
                        : field.value.filter((value) => value !== option);
                      field.onChange(nextValues);
                    }}
                  />
                  <span>{option}</span>
                </label>
              );
            })}
          </div>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

export function OauthClientFormFields({ form, clientId }: OauthClientFormFieldsProps) {
  return (
    <div className="grid gap-5">
      {clientId ? (
        <div className="grid gap-2">
          <Label>Client ID</Label>
          <Input value={clientId} readOnly disabled />
        </div>
      ) : null}

      <FormField
        control={form.control}
        name="name"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Name</FormLabel>
            <FormControl>
              <Input placeholder="Internal admin tool" {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        control={form.control}
        name="clientUri"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Client URI</FormLabel>
            <FormControl>
              <Input placeholder="https://example.com/app" {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        control={form.control}
        name="logoUri"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Logo URI</FormLabel>
            <FormControl>
              <Input placeholder="https://example.com/logo.png" {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        control={form.control}
        name="redirectUrisText"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Redirect URIs</FormLabel>
            <FormDescription>Enter one or more redirect URIs, separated by commas or new lines.</FormDescription>
            <FormControl>
              <Textarea rows={5} placeholder="https://example.com/callback" {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      <CheckboxGroupField
        form={form}
        name="scopes"
        label="Scopes"
        options={OAUTH_SCOPE_OPTIONS}
      />

      <CheckboxGroupField
        form={form}
        name="grantTypes"
        label="Grant types"
        options={OAUTH_GRANT_TYPE_OPTIONS}
      />

      <CheckboxGroupField
        form={form}
        name="responseTypes"
        label="Response types"
        options={OAUTH_RESPONSE_TYPE_OPTIONS}
      />

      <FormField
        control={form.control}
        name="tokenEndpointAuthMethod"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Token endpoint auth method</FormLabel>
            <Select value={field.value} onValueChange={field.onChange}>
              <FormControl>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select an auth method" />
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                {TOKEN_ENDPOINT_AUTH_METHOD_OPTIONS.map((option) => (
                  <SelectItem key={option} value={option}>
                    {option}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        control={form.control}
        name="requirePKCE"
        render={({ field }) => (
          <FormItem className="rounded-md border p-4">
            <div className="flex items-center justify-between gap-4">
              <div className="grid gap-1">
                <FormLabel>Require PKCE</FormLabel>
                <FormDescription>Recommended for browser-based and public clients.</FormDescription>
              </div>
              <FormControl>
                <Switch checked={field.value} onCheckedChange={field.onChange} />
              </FormControl>
            </div>
            <FormMessage />
          </FormItem>
        )}
      />
    </div>
  );
}
