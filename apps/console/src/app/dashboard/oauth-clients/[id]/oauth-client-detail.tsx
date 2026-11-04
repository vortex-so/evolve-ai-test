"use client";

import type { ReactNode } from "react";

import { Badge } from "@vortex/ui/components/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@vortex/ui/components/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@vortex/ui/components/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@vortex/ui/components/tabs";

import type { OAuthClient, OAuthConsent } from "./../types";

type OauthClientDetailProps = {
  client: OAuthClient | null;
  consents: OAuthConsent[];
  error?: string | null;
};

function formatDate(value: string | number | null): string {
  if (!value) {
    return "-";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function ValueList({ values, monospace = false }: { values: string[]; monospace?: boolean }) {
  if (values.length === 0) {
    return <span className="text-muted-foreground">-</span>;
  }

  return (
    <div className="flex flex-wrap gap-2">
      {values.map((value) => (
        <Badge key={value} variant="secondary" className={monospace ? "font-mono" : undefined}>
          {value}
        </Badge>
      ))}
    </div>
  );
}

function DetailRow({
  label,
  value,
  monospace = false,
}: {
  label: string;
  value: ReactNode;
  monospace?: boolean;
}) {
  return (
    <div className="grid gap-2 border-b py-4 last:border-b-0 md:grid-cols-[220px_minmax(0,1fr)] md:items-start">
      <dt className="text-sm font-medium text-muted-foreground">{label}</dt>
      <dd className={monospace ? "font-mono text-sm break-all" : "text-sm break-words"}>{value}</dd>
    </div>
  );
}

export function OauthClientDetail({ client, consents, error = null }: OauthClientDetailProps) {
  if (error || !client) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>OAuth client</CardTitle>
          <CardDescription>Unable to load the requested OAuth client.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            {error ?? "The requested OAuth client could not be found."}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{client.name || client.clientId}</CardTitle>
        <CardDescription>Inspect OAuth client configuration and consent grants.</CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="overview">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="consents">Consents</TabsTrigger>
          </TabsList>

          <TabsContent value="overview">
            <dl>
              <DetailRow label="Name" value={client.name || "-"} />
              <DetailRow label="Client ID" value={client.clientId} monospace />
              <DetailRow label="Internal ID" value={client.id} monospace />
              <DetailRow label="Client URI" value={client.uri || "-"} monospace />
              <DetailRow label="Logo URI" value={client.logoUri || "-"} monospace />
              <DetailRow label="Redirect URIs" value={<ValueList values={client.redirectUris} monospace />} />
              <DetailRow label="Scopes" value={<ValueList values={client.scopes} />} />
              <DetailRow label="Grant types" value={<ValueList values={client.grantTypes} />} />
              <DetailRow label="Response types" value={<ValueList values={client.responseTypes} />} />
              <DetailRow label="Token endpoint auth method" value={client.tokenEndpointAuthMethod || "-"} monospace />
              <DetailRow label="Require PKCE" value={client.requirePKCE ? "Yes" : "No"} />
              <DetailRow label="System client" value={client.isSystem ? "Yes" : "No"} />
              <DetailRow label="Public client" value={client.publicClient ? "Yes" : "No"} />
              <DetailRow label="Created at" value={formatDate(client.createdAt)} />
              <DetailRow label="Updated at" value={formatDate(client.updatedAt)} />
            </dl>
          </TabsContent>

          <TabsContent value="consents">
            <div className="rounded-xl border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>User</TableHead>
                    <TableHead>Scopes</TableHead>
                    <TableHead>Granted at</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {consents.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={3}>
                        <div className="py-8 text-center text-sm text-muted-foreground">
                          No consent grants found.
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : (
                    consents.map((consent) => (
                      <TableRow key={consent.id}>
                        <TableCell>{consent.userEmail ?? consent.userId ?? "Unknown user"}</TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {consent.scopes.map((scope) => (
                              <Badge key={scope} variant="secondary">
                                {scope}
                              </Badge>
                            ))}
                          </div>
                        </TableCell>
                        <TableCell>{formatDate(consent.grantedAt)}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
