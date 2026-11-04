"use client";

import { useMemo, useState } from "react";
import { MoreHorizontalIcon } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@vortex/ui/components/badge";
import { Button } from "@vortex/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@vortex/ui/components/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@vortex/ui/components/dropdown-menu";
import { Input } from "@vortex/ui/components/input";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
} from "@vortex/ui/components/pagination";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@vortex/ui/components/select";
import { Spinner } from "@vortex/ui/components/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@vortex/ui/components/table";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { fetchJson, FetchError, getErrorMessage } from "@/lib/fetch-json";

type DeviceStatus = "pending" | "approved" | "denied" | "expired";

type DeviceRow = {
  id: string;
  deviceCode: string;
  userCode: string;
  userId: string | null;
  userEmail: string | null;
  clientId: string | null;
  status: DeviceStatus | string;
  createdAt: string | number | null;
  expiresAt: string | number | null;
};

type DevicesResponse = {
  rows?: unknown[];
  items?: unknown[];
  next_cursor?: string | null;
};

type DevicesTableProps = {
  initialRows: DeviceRow[];
  initialNextCursor: string | null;
  initialError?: string | null;
};

function normalizeDeviceRow(value: unknown): DeviceRow {
  const record = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};

  return {
    id: String(record.id ?? record.deviceCode ?? ""),
    deviceCode: String(record.deviceCode ?? ""),
    userCode: String(record.userCode ?? ""),
    userId: typeof record.userId === "string" ? record.userId : null,
    userEmail: typeof record.userEmail === "string" ? record.userEmail : null,
    clientId: typeof record.clientId === "string" ? record.clientId : null,
    status: typeof record.status === "string" ? record.status : "pending",
    createdAt: (record.createdAt as string | number | null | undefined) ?? null,
    expiresAt: (record.expiresAt as string | number | null | undefined) ?? null,
  };
}

function normalizeDevicesResponse(payload: DevicesResponse): { rows: DeviceRow[]; nextCursor: string | null } {
  const rows = (payload.items ?? payload.rows ?? []).map((item) => normalizeDeviceRow(item));
  return {
    rows,
    nextCursor: payload.next_cursor ?? null,
  };
}

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

function getStatusBadgeVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "approved":
      return "default";
    case "pending":
      return "secondary";
    case "denied":
      return "destructive";
    case "expired":
      return "outline";
    default:
      return "outline";
  }
}

export function DevicesTable({ initialRows, initialNextCursor, initialError = null }: DevicesTableProps) {
  const [rows, setRows] = useState(initialRows);
  const [error, setError] = useState<string | null>(initialError);
  const [isLoading, setIsLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<"all" | DeviceStatus>("all");
  const [userFilter, setUserFilter] = useState("");
  const [pageCursors, setPageCursors] = useState<Array<string | null>>([null]);
  const [pageIndex, setPageIndex] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(initialNextCursor);
  const [expiringDevice, setExpiringDevice] = useState<DeviceRow | null>(null);
  const [isExpiring, setIsExpiring] = useState(false);

  const visibleRows = useMemo(() => {
    const needle = userFilter.trim().toLowerCase();
    return rows.filter((row) => {
      if (!needle) {
        return true;
      }

      const email = (row.userEmail ?? "unclaimed").toLowerCase();
      return email.includes(needle);
    });
  }, [rows, userFilter]);

  async function loadPage(cursor: string | null, nextPageIndex: number, nextCursors?: Array<string | null>) {
    try {
      setIsLoading(true);
      setError(null);

      const params = new URLSearchParams({ limit: "25" });
      if (statusFilter !== "all") {
        params.set("status", statusFilter);
      }
      if (cursor) {
        params.set("cursor", cursor);
      }

      const response = await fetchJson<DevicesResponse>(`/api/admin/devices?${params.toString()}`, {
        cache: "no-store",
      });

      const normalized = normalizeDevicesResponse(response);
      setRows(normalized.rows);
      setNextCursor(normalized.nextCursor && normalized.nextCursor !== cursor ? normalized.nextCursor : null);
      setPageIndex(nextPageIndex);
      if (nextCursors) {
        setPageCursors(nextCursors);
      }
    } catch (nextError) {
      setError(getErrorMessage(nextError, "Failed to load devices."));
    } finally {
      setIsLoading(false);
    }
  }

  async function resetAndReload(nextStatus: "all" | DeviceStatus) {
    try {
      setIsLoading(true);
      setError(null);

      const params = new URLSearchParams({ limit: "25" });
      if (nextStatus !== "all") {
        params.set("status", nextStatus);
      }

      const response = await fetchJson<DevicesResponse>(`/api/admin/devices?${params.toString()}`, {
        cache: "no-store",
      });

      const normalized = normalizeDevicesResponse(response);
      setRows(normalized.rows);
      setNextCursor(normalized.nextCursor);
      setPageCursors([null]);
      setPageIndex(0);
    } catch (nextError) {
      setError(getErrorMessage(nextError, "Failed to load devices."));
    } finally {
      setIsLoading(false);
    }
  }

  async function expireDevice() {
    if (!expiringDevice) {
      return;
    }

    try {
      setIsExpiring(true);
      await fetchJson("/api/admin/devices/expire", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ deviceCode: expiringDevice.deviceCode }),
      });
      toast.success("Device authorization expired.");
      setExpiringDevice(null);
      await loadPage(pageCursors[pageIndex] ?? null, pageIndex);
    } catch (nextError) {
      if (
        nextError instanceof FetchError &&
        nextError.code === "device_not_found_or_not_pending"
      ) {
        toast.error("Device not found or is no longer pending.");
      } else {
        toast.error(getErrorMessage(nextError, "Failed to expire the device authorization."));
      }
    } finally {
      setIsExpiring(false);
    }
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Device authorizations</CardTitle>
          <CardDescription>Monitor pending and completed device code sign-ins.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-3 md:grid-cols-[220px_minmax(0,1fr)]">
            <div className="grid gap-2">
              <label className="text-sm font-medium">Status</label>
              <Select
                value={statusFilter}
                onValueChange={(value: "all" | DeviceStatus) => {
                  setStatusFilter(value);
                  void resetAndReload(value);
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Filter by status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="approved">Approved</SelectItem>
                  <SelectItem value="expired">Expired</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <label className="text-sm font-medium">User email</label>
              <Input
                value={userFilter}
                onChange={(event) => setUserFilter(event.target.value)}
                placeholder="Search loaded rows by email"
              />
            </div>
          </div>

          {error ? (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
              {error}
            </div>
          ) : null}

          <div className="rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User Code</TableHead>
                  <TableHead>Client ID</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created At</TableHead>
                  <TableHead>Expires At</TableHead>
                  <TableHead className="w-[80px] text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={7}>
                      <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
                        <Spinner />
                        Loading devices...
                      </div>
                    </TableCell>
                  </TableRow>
                ) : visibleRows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7}>
                      <div className="py-8 text-center text-sm text-muted-foreground">
                        No device authorizations found.
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  visibleRows.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell>
                        <code className="text-xs">{row.userCode}</code>
                      </TableCell>
                      <TableCell>
                        <code className="text-xs">{row.clientId ?? "-"}</code>
                      </TableCell>
                      <TableCell>{row.userEmail ?? "unclaimed"}</TableCell>
                      <TableCell>
                        <Badge variant={getStatusBadgeVariant(row.status)}>{row.status}</Badge>
                      </TableCell>
                      <TableCell>{formatDate(row.createdAt)}</TableCell>
                      <TableCell>{formatDate(row.expiresAt)}</TableCell>
                      <TableCell className="text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button type="button" variant="ghost" size="icon-sm" aria-label="Open device actions">
                              <MoreHorizontalIcon className="size-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              variant="destructive"
                              disabled={row.status !== "pending"}
                              onSelect={() => setExpiringDevice(row)}
                            >
                              Force expire
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          <Pagination className="justify-end">
            <PaginationContent>
              <PaginationItem>
                <PaginationPrevious
                  href="#"
                  aria-disabled={pageIndex === 0}
                  className={pageIndex === 0 ? "pointer-events-none opacity-50" : undefined}
                  onClick={(event) => {
                    event.preventDefault();
                    if (pageIndex === 0) {
                      return;
                    }

                    const previousIndex = pageIndex - 1;
                    void loadPage(pageCursors[previousIndex] ?? null, previousIndex);
                  }}
                />
              </PaginationItem>
              <PaginationItem>
                <PaginationNext
                  href="#"
                  aria-disabled={!nextCursor}
                  className={!nextCursor ? "pointer-events-none opacity-50" : undefined}
                  onClick={(event) => {
                    event.preventDefault();
                    if (!nextCursor) {
                      return;
                    }

                    const nextPageIndex = pageIndex + 1;
                    const nextPageCursors = [...pageCursors.slice(0, nextPageIndex), nextCursor];
                    void loadPage(nextCursor, nextPageIndex, nextPageCursors);
                  }}
                />
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={expiringDevice !== null}
        onOpenChange={(open) => {
          if (!open) {
            setExpiringDevice(null);
          }
        }}
        title="Force expire device authorization?"
        description="This immediately invalidates the pending device code. The user will need to restart the device flow."
        confirmLabel="Force expire"
        variant="destructive"
        isPending={isExpiring}
        onConfirm={expireDevice}
      />
    </>
  );
}
