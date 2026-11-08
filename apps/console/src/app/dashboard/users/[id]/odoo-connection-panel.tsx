"use client";

import type { OdooConnectionMetadata, OdooPolicy } from "@vortex/schema";
import { AlertCircle, ExternalLink } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@vortex/ui/components/alert";
import { Badge } from "@vortex/ui/components/badge";
import { Button } from "@vortex/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@vortex/ui/components/card";
import { Checkbox } from "@vortex/ui/components/checkbox";
import { ConfirmDialog } from "@vortex/ui/components/confirm-dialog";
import { Input } from "@vortex/ui/components/input";
import { Label } from "@vortex/ui/components/label";
import { Textarea } from "@vortex/ui/components/textarea";

type OdooResponse = {
  connection?: OdooConnectionMetadata | null;
  gatewayUrl?: string;
  profileAllowsOdoo?: boolean;
};

const emptyPolicy: OdooPolicy = {
  policyVersion: 2,
  enableWrites: false,
  allowedSideEffectMethods: [],
};

const ODOO_METHOD = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*){2,}$/;

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "Request failed.";

  switch (message) {
    case "byok_unavailable":
    case "integration_not_configured":
      return "Odoo BYOK is unavailable because the integration is not configured.";
    case "auth_server_unreachable":
      return "The authentication service is unavailable. Try again shortly.";
    case "version_conflict":
      return "This connection changed elsewhere. Reload before saving or testing.";
    case "api_key_required":
      return "Enter an API key before saving this connection.";
    default:
      return message;
  }
}

async function jsonRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, cache: "no-store" });
  const body = (await response.json().catch(() => null)) as { error?: string } | null;
  if (!response.ok) throw new Error(body?.error ?? `Request failed with status ${response.status}`);
  return body as T;
}

function policyFrom(connection: OdooConnectionMetadata | null): OdooPolicy {
  return connection
    ? {
        policyVersion: 2,
        enableWrites: connection.policy.enableWrites,
        allowedSideEffectMethods: [...connection.policy.allowedSideEffectMethods],
      }
    : { ...emptyPolicy, allowedSideEffectMethods: [] };
}

function parseMethods(value: string): { methods: string[]; invalid: string[] } {
  const entries = value
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
  const methods = [...new Set(entries)].sort();

  return { methods, invalid: methods.filter((method) => !ODOO_METHOD.test(method)) };
}

export function OdooConnectionPanel({ userId }: { userId: string }) {
  const [data, setData] = useState<OdooResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [database, setDatabase] = useState("");
  const [login, setLogin] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [policy, setPolicy] = useState<OdooPolicy>(emptyPolicy);
  const [methodsText, setMethodsText] = useState("");
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    void jsonRequest<OdooResponse>(`/api/admin/users/${userId}/byok/odoo`)
      .then((result) => {
        setData(result);
        if (result.connection) {
          setDatabase(result.connection.database);
          setLogin(result.connection.login);
          setEnabled(result.connection.enabled);
          applyPolicy(policyFrom(result.connection));
        }
      })
      .catch((error) => setLoadError(errorMessage(error)))
      .finally(() => setLoading(false));
  }, [userId]);

  const connection = data?.connection ?? null;
  function applyPolicy(next: OdooPolicy) {
    setPolicy(next);
    setMethodsText(next.allowedSideEffectMethods.join("\n"));
  }

  function clearApiKey() {
    setApiKey("");
  }

  function updateResponse(result: OdooResponse) {
    setData((current) => {
      const nextConnection = Object.prototype.hasOwnProperty.call(result, "connection")
        ? result.connection ?? null
        : current?.connection ?? null;
      return { ...current, ...result, connection: nextConnection };
    });

    if (result.connection) {
      setDatabase(result.connection.database);
      setLogin(result.connection.login);
      setEnabled(result.connection.enabled);
      applyPolicy(policyFrom(result.connection));
    }
  }

  async function save() {
    setFormError(null);
    const parsedMethods = parseMethods(methodsText);
    if (parsedMethods.invalid.length > 0) {
      clearApiKey();
      setFormError(`Invalid Odoo side-effect method: ${parsedMethods.invalid.join(", ")}`);
      return;
    }

    if (
      connection?.hasCredential &&
      !apiKey.trim() &&
      (database !== connection.database || login !== connection.login)
    ) {
      clearApiKey();
      setFormError("Enter a new API key when changing the database or login.");
      return;
    }

    setSaving(true);
    try {
      const result = await jsonRequest<OdooResponse>(`/api/admin/users/${userId}/byok/odoo`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          version: connection?.version ?? 0,
          database,
          login,
          enabled,
          policy: {
            policyVersion: 2,
            enableWrites: policy.enableWrites,
            allowedSideEffectMethods: parsedMethods.methods,
          },
          ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
        }),
      });
      updateResponse(result);
      toast.success("Odoo connection saved.");
    } catch (error) {
      const message = errorMessage(error);
      setFormError(message);
      toast.error(message);
    } finally {
      clearApiKey();
      setSaving(false);
    }
  }

  async function test() {
    if (!connection) return;
    setFormError(null);
    setTesting(true);
    try {
      const result = await jsonRequest<OdooResponse>(`/api/admin/users/${userId}/byok/odoo/test`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ version: connection.version }),
      });
      updateResponse(result);
      toast.success("Odoo connection test passed.");
    } catch (error) {
      const message = errorMessage(error);
      setFormError(message);
      toast.error(message);
    } finally {
      clearApiKey();
      setTesting(false);
    }
  }

  async function revoke() {
    if (!connection) return;
    setFormError(null);
    setRevoking(true);
    try {
      const result = await jsonRequest<OdooResponse>(
        `/api/admin/users/${userId}/byok/odoo?version=${connection.version}`,
        { method: "DELETE" },
      );
      updateResponse(result);
      clearApiKey();
      setDatabase("");
      setLogin("");
      setEnabled(false);
      applyPolicy({ ...emptyPolicy, allowedSideEffectMethods: [] });
      toast.success("Odoo credential revoked.");
    } catch (error) {
      const message = errorMessage(error);
      setFormError(message);
      toast.error(message);
    } finally {
      clearApiKey();
      setRevoking(false);
      setConfirmRevoke(false);
    }
  }

  if (loading) return <div className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">Loading Odoo BYOK settings...</div>;
  if (loadError) return <Alert variant="destructive"><AlertCircle className="size-4" /><AlertTitle>Could not load Odoo BYOK</AlertTitle><AlertDescription>{loadError}</AlertDescription></Alert>;
  if (!data) return <Alert variant="destructive"><AlertTitle>Odoo BYOK unavailable</AlertTitle><AlertDescription>The Odoo integration did not return connection metadata.</AlertDescription></Alert>;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Odoo connection</CardTitle>
          <CardDescription>Credentials are write-only. The API key is never returned, cached, or placed in the URL.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge variant={data.profileAllowsOdoo ? "default" : "destructive"}>{data.profileAllowsOdoo ? "Profile allows Odoo" : "Profile does not allow Odoo"}</Badge>
            {data.gatewayUrl ? <a className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline" href={data.gatewayUrl} target="_blank" rel="noreferrer">Gateway URL <ExternalLink className="size-3" /></a> : null}
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Database" value={database} onChange={setDatabase} placeholder="odoo-production" />
            <Field label="Login" value={login} onChange={setLogin} placeholder="user@example.com" />
            <Field label={connection?.hasCredential ? "API key (replace only)" : "API key"} value={apiKey} onChange={setApiKey} type="password" placeholder={connection?.hasCredential ? "Leave blank to keep current key" : "Required on first save"} autoComplete="new-password" />
            <div className="flex items-end gap-3 pb-1"><Checkbox id="odoo-enabled" checked={enabled} onCheckedChange={(value) => setEnabled(value === true)} /><Label htmlFor="odoo-enabled">Enabled</Label></div>
          </div>

          <div className="space-y-3 border-t pt-5">
            <div><p className="font-medium">Native Odoo permissions</p><p className="text-sm text-muted-foreground">Odoo RBAC controls records and models. This switch controls native CRUD writes; exact listed methods may execute independently of that switch.</p></div>
            <div className="flex items-center gap-3"><Checkbox id="odoo-enable-writes" checked={policy.enableWrites} onCheckedChange={(value) => setPolicy((current) => ({ ...current, enableWrites: value === true }))} /><Label htmlFor="odoo-enable-writes">Enable writes (ODOO_MCP_ENABLE_WRITES)</Label></div>
            <div className="space-y-2"><Label htmlFor="odoo-side-effect-methods">Allowed side-effect methods</Label><Textarea id="odoo-side-effect-methods" value={methodsText} onChange={(event) => setMethodsText(event.target.value)} placeholder={"sale.order.action_confirm\nstock.picking.button_validate"} rows={5} /><p className="text-xs text-muted-foreground">One exact model.method per line. Commas are accepted and normalized; entries are trimmed, deduplicated, and sorted.</p></div>
            {formError ? <Alert variant="destructive"><AlertCircle className="size-4" /><AlertTitle>Could not update Odoo connection</AlertTitle><AlertDescription>{formError}</AlertDescription></Alert> : null}
          </div>

          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void save()} disabled={saving}>{saving ? "Saving..." : "Save connection"}</Button>
            <Button variant="outline" onClick={() => void test()} disabled={!connection || testing}>{testing ? "Testing..." : "Test saved connection"}</Button>
            <Button variant="destructive" onClick={() => setConfirmRevoke(true)} disabled={!connection || revoking}>Revoke credential</Button>
          </div>
          {connection ? <p className="text-xs text-muted-foreground">Version {connection.version} · Test: {connection.testStatus} · Last updated {new Date(connection.updatedAt).toISOString()}</p> : <p className="text-xs text-muted-foreground">No saved Odoo connection.</p>}
        </CardContent>
      </Card>
      <ConfirmDialog open={confirmRevoke} onOpenChange={setConfirmRevoke} title="Revoke Odoo credential?" description="This deletes the stored credential and disables the connection. It cannot be undone from the console." confirmLabel="Revoke credential" variant="destructive" onConfirm={revoke} />
    </div>
  );
}

function Field({ label, value, onChange, type = "text", placeholder, autoComplete }: { label: string; value: string; onChange: (value: string) => void; type?: string; placeholder?: string; autoComplete?: string }) {
  return <div className="space-y-2"><Label>{label}</Label><Input type={type} value={value} placeholder={placeholder} autoComplete={autoComplete} onChange={(event) => onChange(event.target.value)} /></div>;
}
