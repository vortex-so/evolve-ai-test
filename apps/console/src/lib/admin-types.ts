export type AdminUser = {
  id: string;
  name: string | null;
  email: string | null;
  image: string | null;
  role: string | null;
  banned: boolean;
  banReason: string | null;
  banExpires: string | null;
  emailVerified: boolean;
  createdAt: string | null;
  updatedAt: string | null;
};

export type AdminSessionItem = {
  id: string;
  token: string | null;
  userId: string | null;
  userName: string | null;
  userEmail: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  expiresAt: string | null;
  impersonatedBy: string | null;
};

export type AdminAccount = {
  id: string;
  accountId: string | null;
  providerId: string | null;
  scope: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export type AdminTwoFactor = {
  id: string;
  verified: boolean;
  failedVerificationCount: number;
  lockedUntil: string | null;
};

export type AdminPasskey = {
  id: string;
  name: string | null;
  credentialID: string | null;
  counter: number;
  deviceType: string | null;
  backedUp: boolean;
  transports: string | null;
  createdAt: string | null;
  aaguid: string | null;
};

export type AdminAuditItem = {
  id: string;
  createdAt: string | null;
  action: string | null;
  actorEmail: string | null;
  actorUserId: string | null;
  targetType: string | null;
  targetId: string | null;
  outcome: string | null;
  statusCode: number | null;
  ip: string | null;
  userAgent: string | null;
};

export type AdminUserDetail = AdminUser & {
  accounts: AdminAccount[];
  twoFactor: AdminTwoFactor[];
  passkeys: AdminPasskey[];
};

export type CursorPage<T> = {
  items: T[];
  nextCursor: string | null;
  total: number | null;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string | null {
  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number") {
    return String(value);
  }

  return null;
}

function asBoolean(value: unknown): boolean {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return value === 1;
  }

  if (typeof value === "string") {
    return value === "true" || value === "1";
  }

  return false;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) {
    return "-";
  }

  const parsed = Number(value);
  const date = Number.isFinite(parsed) ? new Date(parsed) : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function formatUserDisplayName(user: Pick<AdminUser, "name" | "email" | "id">): string {
  return user.name || user.email || user.id;
}

export function normalizeAdminUser(value: unknown): AdminUser {
  const record = asRecord(value);

  return {
    id: asString(record.id) ?? "",
    name: asString(record.name),
    email: asString(record.email),
    image: asString(record.image),
    role: asString(record.role),
    banned: asBoolean(record.banned),
    banReason: asString(record.banReason),
    banExpires: asString(record.banExpires),
    emailVerified: asBoolean(record.emailVerified),
    createdAt: asString(record.createdAt),
    updatedAt: asString(record.updatedAt),
  };
}

export function normalizeAdminUsersResponse(value: unknown): CursorPage<AdminUser> {
  const record = asRecord(value);
  const users = asArray(record.users ?? record.items ?? record.rows).map(normalizeAdminUser);

  return {
    items: users,
    nextCursor: asString(record.next_cursor),
    total: asNumber(record.total) ?? users.length,
  };
}

export function filterAdminUsers(users: AdminUser[], search: string): AdminUser[] {
  const query = search.trim().toLowerCase();

  if (!query) {
    return users;
  }

  return users.filter((user) => {
    const haystack = [user.name, user.email, user.role].filter(Boolean).join(" ").toLowerCase();
    return haystack.includes(query);
  });
}

export function normalizeAdminSession(value: unknown): AdminSessionItem {
  const record = asRecord(value);

  return {
    id: asString(record.id) ?? "",
    token: asString(record.token),
    userId: asString(record.userId),
    userName: asString(record.userName),
    userEmail: asString(record.userEmail),
    ipAddress: asString(record.ipAddress),
    userAgent: asString(record.userAgent),
    createdAt: asString(record.createdAt),
    updatedAt: asString(record.updatedAt),
    expiresAt: asString(record.expiresAt),
    impersonatedBy: asString(record.impersonatedBy),
  };
}

export function normalizeAdminSessionsResponse(value: unknown): CursorPage<AdminSessionItem> {
  const record = asRecord(value);
  const items = asArray(record.sessions ?? record.items ?? record.rows).map(normalizeAdminSession);

  return {
    items,
    nextCursor: asString(record.next_cursor),
    total: asNumber(record.total) ?? items.length,
  };
}

function normalizeAdminAccount(value: unknown): AdminAccount {
  const record = asRecord(value);

  return {
    id: asString(record.id) ?? "",
    accountId: asString(record.accountId),
    providerId: asString(record.providerId),
    scope: asString(record.scope),
    createdAt: asString(record.createdAt),
    updatedAt: asString(record.updatedAt),
  };
}

function normalizeAdminTwoFactor(value: unknown): AdminTwoFactor {
  const record = asRecord(value);

  return {
    id: asString(record.id) ?? "",
    verified: asBoolean(record.verified),
    failedVerificationCount: asNumber(record.failedVerificationCount) ?? 0,
    lockedUntil: asString(record.lockedUntil),
  };
}

function normalizeAdminPasskey(value: unknown): AdminPasskey {
  const record = asRecord(value);

  return {
    id: asString(record.id) ?? "",
    name: asString(record.name),
    credentialID: asString(record.credentialID),
    counter: asNumber(record.counter) ?? 0,
    deviceType: asString(record.deviceType),
    backedUp: asBoolean(record.backedUp),
    transports: asString(record.transports),
    createdAt: asString(record.createdAt),
    aaguid: asString(record.aaguid),
  };
}

export function normalizeAdminUserDetailResponse(value: unknown): AdminUserDetail {
  const record = asRecord(value);
  const user = asRecord(record.user);
  const normalizedUser = normalizeAdminUser(user);

  return {
    ...normalizedUser,
    accounts: asArray(user.accounts).map(normalizeAdminAccount),
    twoFactor: asArray(user.twoFactor).map(normalizeAdminTwoFactor),
    passkeys: asArray(user.passkeys).map(normalizeAdminPasskey),
  };
}

export function normalizeAdminAudit(value: unknown): AdminAuditItem {
  const record = asRecord(value);

  return {
    id: asString(record.id) ?? "",
    createdAt: asString(record.created_at ?? record.createdAt),
    action: asString(record.action),
    actorEmail: asString(record.actor_email_snapshot ?? record.actorEmail),
    actorUserId: asString(record.actor_user_id ?? record.actorUserId),
    targetType: asString(record.target_type ?? record.targetType),
    targetId: asString(record.target_id ?? record.targetId),
    outcome: asString(record.outcome),
    statusCode: asNumber(record.status_code ?? record.statusCode),
    ip: asString(record.ip),
    userAgent: asString(record.user_agent ?? record.userAgent),
  };
}

export function normalizeAdminAuditResponse(value: unknown): CursorPage<AdminAuditItem> {
  const record = asRecord(value);
  const items = asArray(record.items ?? record.rows).map(normalizeAdminAudit);

  return {
    items,
    nextCursor: asString(record.next_cursor),
    total: asNumber(record.total) ?? items.length,
  };
}

export function extractCollectionCount(value: unknown): number {
  const record = asRecord(value);
  const total = asNumber(record.total);
  if (total !== null) {
    return total;
  }

  const items = asArray(record.users ?? record.items ?? record.rows ?? record.sessions);
  return items.length;
}

export function getErrorMessage(error: unknown, fallback = "Something went wrong."): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return fallback;
}
