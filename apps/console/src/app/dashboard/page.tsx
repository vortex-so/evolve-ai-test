import {
  Activity,
  KeyRound,
  Monitor,
  Smartphone,
} from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@vortex/ui/components/card";

import { fetchAdminJson } from "@/lib/admin-server";
import { extractCollectionCount } from "@/lib/admin-types";

export const dynamic = "force-dynamic";

const metricCards = [
  {
    key: "sessions",
    title: "Active sessions",
    description: "Current signed-in sessions returned by the admin API.",
    icon: Monitor,
  },
  {
    key: "devices",
    title: "Pending device grants",
    description: "Device code flows still waiting for user approval.",
    icon: Smartphone,
  },
  {
    key: "oauthClients",
    title: "OAuth clients",
    description: "Registered clients visible to the console BFF.",
    icon: KeyRound,
  },
  {
    key: "audit",
    title: "Admin actions (24h)",
    description: "Recent audit entries fetched from the admin audit log.",
    icon: Activity,
  },
] as const;

export default async function DashboardPage() {
  const [sessions, devices, oauthClients, audit] = await Promise.all([
    fetchAdminJson<unknown>("/api/admin/sessions?limit=1"),
    fetchAdminJson<unknown>("/api/admin/devices?limit=1&status=pending"),
    fetchAdminJson<unknown>("/api/admin/oauth-clients?limit=1"),
    fetchAdminJson<unknown>(`/api/admin/audit?limit=1&from=${Date.now() - 86_400_000}`),
  ]);

  const values = {
    sessions: extractCollectionCount(sessions),
    devices: extractCollectionCount(devices),
    oauthClients: extractCollectionCount(oauthClients),
    audit: extractCollectionCount(audit),
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold">Dashboard</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          A quick snapshot of the core admin surfaces wired through the console BFF.
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {metricCards.map((metric) => {
          const Icon = metric.icon;

          return (
            <Card key={metric.key}>
              <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
                <div>
                  <CardTitle className="text-base">{metric.title}</CardTitle>
                  <CardDescription className="mt-1">{metric.description}</CardDescription>
                </div>
                <div className="rounded-lg bg-primary/10 p-2 text-primary">
                  <Icon className="size-4" />
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-semibold">{values[metric.key]}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
