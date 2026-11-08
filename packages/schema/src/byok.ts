export type OdooPolicy = {
  policyVersion: 2;
  enableWrites: boolean;
  allowedSideEffectMethods: string[];
};

export type HistoricalOdooTaskValues = {
  name?: string;
  description?: string;
  date_deadline?: string | false;
  priority?: "0" | "1";
};

export type HistoricalOdooApprovalPayload = {
  projectId?: number;
  taskId?: number;
  values: HistoricalOdooTaskValues;
};

export type OdooConnectionMetadata = {
  id: string;
  userId: string;
  provider: "odoo";
  baseUrl: string;
  database: string;
  login: string;
  enabled: boolean;
  version: number;
  hasCredential: boolean;
  testedVersion: number | null;
  testedAt: number | null;
  testStatus: "not_tested" | "ok" | "failed";
  odooUid: number | null;
  policy: OdooPolicy;
  createdAt: number;
  updatedAt: number;
};

export type OdooApprovalItem = {
  id: string;
  connectionId: string;
  userId: string;
  userEmail: string;
  version: number;
  operation: "create" | "update";
  payload: HistoricalOdooApprovalPayload;
  before: object | null;
  payloadHash: string;
  status: "pending" | "approved" | "rejected" | "executing" | "executed" | "outcome_unknown" | "failed";
  createdAt: number;
  expiresAt: number;
  approvedBy: string | null;
  approvedAt: number | null;
};
