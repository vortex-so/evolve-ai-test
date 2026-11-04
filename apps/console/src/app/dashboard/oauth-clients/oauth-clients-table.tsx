"use client";

import Link from "next/link";
import { useState } from "react";
import { MoreHorizontalIcon, PlusIcon } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@vortex/ui/components/badge";
import { Button } from "@vortex/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@vortex/ui/components/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@vortex/ui/components/dropdown-menu";
import { Spinner } from "@vortex/ui/components/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@vortex/ui/components/table";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@vortex/ui/components/tooltip";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { fetchJson, FetchError, getErrorMessage } from "@/lib/fetch-json";

import { CreateOauthClientSheet } from "./create-oauth-client-sheet";
import { EditOauthClientSheet } from "./edit-oauth-client-sheet";
import { RotateSecretDialog } from "./rotate-secret-dialog";
import { normalizeOAuthClientsResponse, type OAuthClient, type OAuthClientsResponse } from "./types";

type OauthClientsTableProps = {
  initialClients: OAuthClient[];
  initialError?: string | null;
};

function formatBadgeLabel(value: string): string {
  return value === "urn:ietf:params:oauth:grant-type:device_code" ? "device_code" : value;
}

export function OauthClientsTable({ initialClients, initialError = null }: OauthClientsTableProps) {
  const [clients, setClients] = useState(initialClients);
  const [error, setError] = useState<string | null>(initialError);
  const [isLoading, setIsLoading] = useState(false);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingClient, setEditingClient] = useState<OAuthClient | null>(null);
  const [rotatingClient, setRotatingClient] = useState<OAuthClient | null>(null);
  const [deletingClient, setDeletingClient] = useState<OAuthClient | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  async function refetchClients() {
    try {
      setIsLoading(true);
      setError(null);
      const response = await fetchJson<OAuthClientsResponse>("/api/admin/oauth-clients", {
        cache: "no-store",
      });
      setClients(normalizeOAuthClientsResponse(response));
    } catch (nextError) {
      setError(getErrorMessage(nextError, "Failed to load OAuth clients."));
    } finally {
      setIsLoading(false);
    }
  }

  async function deleteClient() {
    if (!deletingClient) {
      return;
    }

    try {
      setIsDeleting(true);
      await fetchJson(`/api/admin/oauth-clients/${deletingClient.id}`, {
        method: "DELETE",
      });
      toast.success("OAuth client deleted.");
      setDeletingClient(null);
      await refetchClients();
    } catch (nextError) {
      if (nextError instanceof FetchError && nextError.code === "system_client_protected") {
        toast.error("System clients cannot be deleted.");
      } else {
        toast.error(getErrorMessage(nextError, "Failed to delete the OAuth client."));
      }
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <TooltipProvider>
      <Card>
        <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="grid gap-1">
            <CardTitle>OAuth clients</CardTitle>
            <CardDescription>Manage confidential, public, and device flow clients.</CardDescription>
          </div>
          <Button type="button" onClick={() => setIsCreateOpen(true)}>
            <PlusIcon className="size-4" />
            New OAuth client
          </Button>
        </CardHeader>
        <CardContent className="grid gap-4">
          {error ? (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
              {error}
            </div>
          ) : null}

          <div className="rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Client ID</TableHead>
                  <TableHead>Grant types</TableHead>
                  <TableHead>Redirect URIs</TableHead>
                  <TableHead>System</TableHead>
                  <TableHead className="w-[80px] text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={6}>
                      <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
                        <Spinner />
                        Loading OAuth clients...
                      </div>
                    </TableCell>
                  </TableRow>
                ) : clients.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6}>
                      <div className="py-8 text-center text-sm text-muted-foreground">
                        No OAuth clients found.
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  clients.map((client) => (
                    <TableRow key={client.id}>
                      <TableCell>
                        <div className="grid gap-1">
                          <span className="font-medium">{client.name || client.clientId}</span>
                          {client.disabled ? (
                            <span className="text-xs text-muted-foreground">Disabled</span>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell>
                        <code className="text-xs">{client.clientId}</code>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {client.grantTypes.length > 0 ? (
                            client.grantTypes.map((grantType) => (
                              <Badge key={grantType} variant="secondary">
                                {formatBadgeLabel(grantType)}
                              </Badge>
                            ))
                          ) : (
                            <span className="text-sm text-muted-foreground">None</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="max-w-sm">
                        {client.redirectUris.length > 0 ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <div className="truncate text-sm text-muted-foreground">
                                {client.redirectUris.join(", ")}
                              </div>
                            </TooltipTrigger>
                            <TooltipContent className="max-w-md text-left">
                              {client.redirectUris.join("\n")}
                            </TooltipContent>
                          </Tooltip>
                        ) : (
                          <span className="text-sm text-muted-foreground">None</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {client.isSystem ? <Badge>System</Badge> : <span className="text-muted-foreground">-</span>}
                      </TableCell>
                      <TableCell className="text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button type="button" variant="ghost" size="icon-sm" aria-label="Open client actions">
                              <MoreHorizontalIcon className="size-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem asChild>
                              <Link href={`/dashboard/oauth-clients/${client.id}`}>View</Link>
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => setEditingClient(client)}>
                              Edit
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => setRotatingClient(client)}>
                              Rotate secret
                            </DropdownMenuItem>
                            {client.isSystem ? (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <div>
                                    <DropdownMenuItem disabled>Delete</DropdownMenuItem>
                                  </div>
                                </TooltipTrigger>
                                <TooltipContent>System clients cannot be deleted.</TooltipContent>
                              </Tooltip>
                            ) : (
                              <DropdownMenuItem variant="destructive" onSelect={() => setDeletingClient(client)}>
                                Delete
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <CreateOauthClientSheet
        open={isCreateOpen}
        onOpenChange={setIsCreateOpen}
        onCreated={refetchClients}
      />
      <EditOauthClientSheet
        client={editingClient}
        open={editingClient !== null}
        onOpenChange={(open) => {
          if (!open) {
            setEditingClient(null);
          }
        }}
        onUpdated={refetchClients}
      />
      <RotateSecretDialog
        client={rotatingClient}
        open={rotatingClient !== null}
        onOpenChange={(open) => {
          if (!open) {
            setRotatingClient(null);
          }
        }}
        onRotated={refetchClients}
      />
      <ConfirmDialog
        open={deletingClient !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDeletingClient(null);
          }
        }}
        title="Delete OAuth client?"
        description="This permanently removes the client. Any dependent integrations will stop working immediately."
        confirmLabel="Delete client"
        variant="destructive"
        isPending={isDeleting}
        onConfirm={deleteClient}
      />
    </TooltipProvider>
  );
}
