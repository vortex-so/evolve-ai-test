import { DevicesTable } from "./devices-table";

import { fetchAdminPageJson } from "@/lib/admin-page-fetch";
import { getErrorMessage } from "@/lib/fetch-json";

type DevicesResponse = {
  rows?: unknown[];
  items?: unknown[];
  next_cursor?: string | null;
};

type DeviceRow = {
  id: string;
  deviceCode: string;
  userCode: string;
  userId: string | null;
  userEmail: string | null;
  clientId: string | null;
  status: string;
  createdAt: string | number | null;
  expiresAt: string | number | null;
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

export const dynamic = "force-dynamic";

export default async function DevicesPage() {
  let initialRows: DeviceRow[] = [];
  let initialNextCursor: string | null = null;
  let initialError: string | null = null;

  try {
    const response = await fetchAdminPageJson<DevicesResponse>("/api/admin/devices?limit=25");
    initialRows = (response.items ?? response.rows ?? []).map((item) => normalizeDeviceRow(item));
    initialNextCursor = response.next_cursor ?? null;
  } catch (error) {
    initialError = getErrorMessage(error, "Failed to load devices.");
  }

  return (
    <DevicesTable
      initialRows={initialRows}
      initialNextCursor={initialNextCursor}
      initialError={initialError}
    />
  );
}
