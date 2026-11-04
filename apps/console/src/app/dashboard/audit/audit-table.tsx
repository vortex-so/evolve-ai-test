"use client";

import type { ColumnDef } from "@tanstack/react-table";
import {
  Check,
  ChevronsUpDown,
  Copy,
  RotateCcw,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";

import { Badge } from "@vortex/ui/components/badge";
import { Button } from "@vortex/ui/components/button";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@vortex/ui/components/command";
import { DataTable } from "@vortex/ui/components/data-table";
import { Input } from "@vortex/ui/components/input";
import { Popover, PopoverContent, PopoverTrigger } from "@vortex/ui/components/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@vortex/ui/components/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@vortex/ui/components/tooltip";

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export type AuditRow = {
  id: string;
  created_at: number;
  actor_user_id: string | null;
  actor_email_snapshot: string;
  actor_role_snapshot: string;
  acting_as_user_id: string | null;
  action: string;
  target_type: string;
  target_id: string | null;
  target_snapshot: JsonValue;
  outcome: string;
  status_code: number | null;
  metadata: JsonValue;
};

const ACTION_OPTIONS = [
  "better_auth.admin.set-role",
  "better_auth.admin.remove-user",
  "better_auth.admin.ban-user",
  "admin.oauth_clients.update",
  "admin.oauth_clients.delete",
  "admin.bootstrap_profiles.update",
  "admin.bootstrap_profiles.delete",
  "admin.bootstrap_assignments.upsert",
  "admin.devices.expire",
];

const TARGET_TYPE_OPTIONS = [
  { label: "user", value: "user" },
  { label: "oauth_client", value: "oauth_client" },
  { label: "bootstrap_profile", value: "bootstrap_profile" },
  { label: "device", value: "device_code" },
];

type AuditTableProps = {
  initialRows: AuditRow[];
  nextCursor: string | null;
  initialError?: string;
};

function formatTimestamp(value: number): string {
  return new Date(value).toISOString();
}

function formatRelativeTimestamp(value: number): string {
  const diffMs = value - Date.now();
  const absMs = Math.abs(diffMs);
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

  if (absMs < 60_000) {
    return rtf.format(Math.round(diffMs / 1_000), "second");
  }
  if (absMs < 3_600_000) {
    return rtf.format(Math.round(diffMs / 60_000), "minute");
  }
  if (absMs < 86_400_000) {
    return rtf.format(Math.round(diffMs / 3_600_000), "hour");
  }
  return rtf.format(Math.round(diffMs / 86_400_000), "day");
}

function toPrettyJson(value: JsonValue): string {
  return JSON.stringify(value ?? null, null, 2);
}

function getFilterSignature(searchParams: URLSearchParams): string {
  const clone = new URLSearchParams(searchParams);
  clone.delete("cursor");
  return clone.toString();
}

function toDateInputValue(timestamp: string | null): string {
  if (!timestamp) {
    return "";
  }

  const value = Number(timestamp);
  if (!Number.isFinite(value)) {
    return "";
  }

  return new Date(value).toISOString().slice(0, 10);
}

function toStartOfDayTimestamp(value: string): string | null {
  if (!value) {
    return null;
  }

  return String(new Date(`${value}T00:00:00.000Z`).getTime());
}

function toEndOfDayTimestamp(value: string): string | null {
  if (!value) {
    return null;
  }

  return String(new Date(`${value}T23:59:59.999Z`).getTime());
}

function ActionFilter({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className="w-full justify-between sm:w-[240px]"
          type="button"
        >
          <span className="truncate">{value || "Any action"}</span>
          <ChevronsUpDown className="size-4 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[280px] p-0">
        <Command>
          <CommandInput placeholder="Filter actions..." />
          <CommandList>
            <CommandEmpty>No action found.</CommandEmpty>
            <CommandItem
              value="__any_action__"
              onSelect={() => {
                onChange("");
                setOpen(false);
              }}
            >
              Any action
              {!value ? <Check className="ml-auto size-4" /> : null}
            </CommandItem>
            {ACTION_OPTIONS.map((action) => (
              <CommandItem
                key={action}
                value={action}
                onSelect={() => {
                  onChange(action);
                  setOpen(false);
                }}
              >
                {action}
                {value === action ? <Check className="ml-auto size-4" /> : null}
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export function AuditTable({ initialRows, nextCursor, initialError }: AuditTableProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);
  const [previousCursors, setPreviousCursors] = useState<string[]>([]);
  const [actor, setActor] = useState(() => searchParams.get("actor") ?? "");
  const [targetId, setTargetId] = useState(() => searchParams.get("target_id") ?? "");
  const actorDebounceRef = useRef<number | null>(null);
  const targetIdDebounceRef = useRef<number | null>(null);

  const params = useMemo(() => new URLSearchParams(searchParams.toString()), [searchParams]);
  const currentCursor = params.get("cursor") ?? "";
  const currentAction = params.get("action") ?? "";
  const currentTargetType = params.get("target_type") ?? "";
  const currentOutcome = params.get("outcome") ?? "";
  const currentFrom = toDateInputValue(params.get("from"));
  const currentTo = toDateInputValue(params.get("to"));
  const filterSignature = getFilterSignature(params);

  useEffect(() => {
    setActor(params.get("actor") ?? "");
    setTargetId(params.get("target_id") ?? "");
  }, [filterSignature, params]);

  useEffect(() => {
    setPreviousCursors([]);
  }, [filterSignature]);

  useEffect(() => {
    if (actorDebounceRef.current) {
      window.clearTimeout(actorDebounceRef.current);
    }

    actorDebounceRef.current = window.setTimeout(() => {
      replaceQuery({ actor, cursor: null });
    }, 250);

    return () => {
      if (actorDebounceRef.current) {
        window.clearTimeout(actorDebounceRef.current);
      }
    };
  }, [actor]);

  useEffect(() => {
    if (targetIdDebounceRef.current) {
      window.clearTimeout(targetIdDebounceRef.current);
    }

    targetIdDebounceRef.current = window.setTimeout(() => {
      replaceQuery({ target_id: targetId, cursor: null });
    }, 250);

    return () => {
      if (targetIdDebounceRef.current) {
        window.clearTimeout(targetIdDebounceRef.current);
      }
    };
  }, [targetId]);

  function replaceQuery(updates: Record<string, string | null>) {
    const next = new URLSearchParams(searchParams.toString());

    for (const [key, value] of Object.entries(updates)) {
      if (!value) {
        next.delete(key);
      } else {
        next.set(key, value);
      }
    }

    const nextQuery = next.toString();
    const nextUrl = `${pathname}${nextQuery ? `?${nextQuery}` : ""}`;
    const currentUrl = `${pathname}${searchParams.toString() ? `?${searchParams.toString()}` : ""}`;

    if (nextUrl === currentUrl) {
      return;
    }

    startTransition(() => {
      router.replace(nextUrl);
    });
  }

  const columns = useMemo<ColumnDef<AuditRow>[]>(
    () => [
      {
        accessorKey: "created_at",
        header: "Timestamp",
        cell: ({ row }) => {
          const value = row.original.created_at;
          return (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="cursor-default text-sm">{formatTimestamp(value)}</span>
              </TooltipTrigger>
              <TooltipContent>{formatRelativeTimestamp(value)}</TooltipContent>
            </Tooltip>
          );
        },
      },
      {
        accessorKey: "actor_email_snapshot",
        header: "Actor",
        cell: ({ row }) => {
          const actorLabel = row.original.actor_email_snapshot;
          const actingAs = row.original.acting_as_user_id;
          return (
            <div className="min-w-0">
              <p className="truncate font-medium">{actorLabel}</p>
              {actingAs ? (
                <p className="truncate text-xs text-muted-foreground">(as {actingAs})</p>
              ) : null}
            </div>
          );
        },
      },
      {
        accessorKey: "action",
        header: "Action",
        cell: ({ row }) => <Badge variant="outline">{row.original.action}</Badge>,
      },
      {
        id: "target",
        header: "Target",
        cell: ({ row }) => {
          const label = `${row.original.target_type}/${row.original.target_id ?? "-"}`;
          return (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-auto px-0 font-mono text-xs"
              onClick={(event) => {
                event.stopPropagation();
                void navigator.clipboard.writeText(label);
                toast.success("Target copied");
              }}
            >
              {label}
              <Copy className="size-3" />
            </Button>
          );
        },
      },
      {
        accessorKey: "outcome",
        header: "Outcome",
        cell: ({ row }) => (
          <Badge
            variant={row.original.outcome === "success" ? "default" : "destructive"}
            className={
              row.original.outcome === "success"
                ? "bg-emerald-600 text-white dark:bg-emerald-600"
                : undefined
            }
          >
            {row.original.outcome}
          </Badge>
        ),
      },
      {
        accessorKey: "status_code",
        header: "Status Code",
        cell: ({ row }) => row.original.status_code ?? "-",
      },
    ],
    [],
  );

  return (
    <TooltipProvider>
      <div className="space-y-4">
        <div className="grid gap-3 rounded-lg border bg-card p-4 sm:grid-cols-2 xl:grid-cols-4">
          <Input
            placeholder="Search actor email"
            value={actor}
            onChange={(event) => setActor(event.target.value)}
          />
          <ActionFilter
            value={currentAction}
            onChange={(value) => replaceQuery({ action: value, cursor: null })}
          />
          <Select
            value={currentTargetType || "any"}
            onValueChange={(value) =>
              replaceQuery({ target_type: value === "any" ? null : value, cursor: null })
            }
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Any target type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="any">Any target type</SelectItem>
              {TARGET_TYPE_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            className="font-mono"
            placeholder="Target id"
            value={targetId}
            onChange={(event) => setTargetId(event.target.value)}
          />
          <Select
            value={currentOutcome || "any"}
            onValueChange={(value) =>
              replaceQuery({ outcome: value === "any" ? null : value, cursor: null })
            }
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Any outcome" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="any">Any outcome</SelectItem>
              <SelectItem value="success">success</SelectItem>
              <SelectItem value="failure">failure</SelectItem>
            </SelectContent>
          </Select>
            <Input
              type="date"
              value={currentFrom}
              onChange={(event) =>
                replaceQuery({ from: toStartOfDayTimestamp(event.target.value), cursor: null })
              }
            />
            <Input
              type="date"
              value={currentTo}
              onChange={(event) =>
                replaceQuery({ to: toEndOfDayTimestamp(event.target.value), cursor: null })
              }
            />
          <Button
            type="button"
            variant="outline"
            className="justify-self-start"
            onClick={() => {
              setActor("");
              setTargetId("");
              setPreviousCursors([]);
              startTransition(() => {
                router.replace(pathname);
              });
            }}
          >
            <RotateCcw className="size-4" />
            Clear filters
          </Button>
        </div>

        <DataTable
          columns={columns}
          data={initialRows}
          loading={isPending}
          error={initialError}
          emptyMessage="No audit events match the current filters."
          getRowId={(row) => row.id}
          onRowClick={(row) => {
            setExpandedRowId((current) => (current === row.id ? null : row.id));
          }}
          renderExpandedRow={(row) => {
            if (expandedRowId !== row.id) {
              return null;
            }

            return (
              <div className="grid gap-4 p-4 lg:grid-cols-2">
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Metadata
                  </p>
                  <pre className="overflow-x-auto rounded bg-muted p-4 text-xs">
                    {toPrettyJson(row.metadata)}
                  </pre>
                </div>
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Target Snapshot
                  </p>
                  <pre className="overflow-x-auto rounded bg-muted p-4 text-xs">
                    {toPrettyJson(row.target_snapshot)}
                  </pre>
                </div>
              </div>
            );
          }}
        />

        <div className="flex items-center justify-between gap-3 rounded-lg border bg-card p-4">
          <p className="text-sm text-muted-foreground">
            {initialRows.length} row{initialRows.length === 1 ? "" : "s"} loaded
          </p>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={previousCursors.length === 0 || isPending}
              onClick={() => {
                const stack = [...previousCursors];
                const previous = stack.pop() ?? "";
                setPreviousCursors(stack);
                replaceQuery({ cursor: previous || null });
              }}
            >
              Previous
            </Button>
            <Button
              type="button"
              disabled={!nextCursor || nextCursor === currentCursor || isPending}
              onClick={() => {
                setPreviousCursors((current) => [...current, currentCursor]);
                replaceQuery({ cursor: nextCursor });
              }}
            >
              Next
            </Button>
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}
