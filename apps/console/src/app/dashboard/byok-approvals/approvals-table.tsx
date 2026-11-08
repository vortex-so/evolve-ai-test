"use client";

import type { OdooApprovalItem } from "@vortex/schema";
import { useState } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@vortex/ui/components/alert";
import { Badge } from "@vortex/ui/components/badge";
import { Button } from "@vortex/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@vortex/ui/components/card";

function plain(value: unknown): string { return value === null ? "null" : JSON.stringify(value, null, 2); }
function date(value: number): string { return new Date(value).toISOString(); }

export function ApprovalsTable({ initialItems, initialError }: { initialItems: OdooApprovalItem[]; initialError?: string }) {
  const [items, setItems] = useState(initialItems);
  const [pending, setPending] = useState<string | null>(null);

  async function decide(item: OdooApprovalItem, decision: "approve" | "reject") {
    setPending(item.id);
    try {
      const response = await fetch(`/api/admin/byok/approvals/${item.id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ decision }) });
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) throw new Error(body?.error ?? `Request failed with status ${response.status}`);
      setItems((current) => current.map((candidate) => candidate.id === item.id ? { ...candidate, status: decision === "approve" ? "approved" : "rejected", approvedAt: Date.now() } : candidate));
      toast.success(`Approval ${decision}d.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Approval failed.";
      toast.error(message === "approval_not_pending" ? "Approval is no longer pending, valid, or allowed for this admin." : message);
    } finally { setPending(null); }
  }

  if (initialError) return <Alert variant="destructive"><AlertTitle>Approval list unavailable</AlertTitle><AlertDescription>{initialError}</AlertDescription></Alert>;
  if (items.length === 0) return <div className="rounded-xl border border-dashed bg-card/60 p-8 text-center text-sm text-muted-foreground">No BYOK approvals in the last 30 days.</div>;

  return <div className="space-y-4">{items.map((item) => <Card key={item.id}><CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between"><div><CardTitle className="text-base">{item.operation} task for {item.userEmail}</CardTitle><p className="mt-1 text-sm text-muted-foreground">Created {date(item.createdAt)} · Expires {date(item.expiresAt)} · Version {item.version}</p></div><Badge variant={item.status === "pending" ? "default" : item.status === "outcome_unknown" ? "destructive" : "outline"}>{item.status}</Badge></CardHeader><CardContent className="space-y-4"><div className="grid gap-4 lg:grid-cols-2"><Review title="Before" value={item.before} /><Review title="After" value={item.payload} /></div>{item.status === "outcome_unknown" ? <Alert variant="destructive"><AlertTitle>Unknown outcome</AlertTitle><AlertDescription>Do not retry automatically. Confirm the downstream execution result before taking another action.</AlertDescription></Alert> : null}{item.status === "pending" ? <div className="flex flex-wrap gap-2"><Button onClick={() => void decide(item, "approve")} disabled={pending === item.id}>Approve stored change</Button><Button variant="outline" onClick={() => void decide(item, "reject")} disabled={pending === item.id}>Reject</Button><p className="basis-full text-xs text-muted-foreground">Self approval is prohibited by the server. This approval authorizes the stored one-time change; it does not execute it now.</p></div> : null}</CardContent></Card>)}</div>;
}

function Review({ title, value }: { title: string; value: unknown }) { return <div className="min-w-0 space-y-2"><p className="text-sm font-medium">{title}</p><pre className="max-h-72 overflow-auto rounded-lg border bg-muted/40 p-3 text-xs leading-5 whitespace-pre-wrap">{plain(value)}</pre></div>; }
