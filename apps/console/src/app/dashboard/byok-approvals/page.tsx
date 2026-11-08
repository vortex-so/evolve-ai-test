import Link from "next/link";
import { Alert, AlertDescription, AlertTitle } from "@vortex/ui/components/alert";

export const dynamic = "force-dynamic";

export default async function ByokApprovalsPage() {
  return (
    <section className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">BYOK approvals retired</h1>
        <p className="text-sm text-muted-foreground">The one-time custom approval workflow is no longer active.</p>
      </div>
      <Alert>
        <AlertTitle>Use native Odoo controls instead</AlertTitle>
        <AlertDescription>
          Preview the connection and native policy on the user page, validate the exact settings, and confirm the saved connection there. Historical approval records remain available through the audit log.
        </AlertDescription>
      </Alert>
      <div className="flex flex-wrap gap-4 text-sm">
        <Link className="text-primary underline-offset-4 hover:underline" href="/dashboard/users">Open users</Link>
        <Link className="text-primary underline-offset-4 hover:underline" href="/dashboard/audit-log">Open audit log</Link>
      </div>
    </section>
  );
}
