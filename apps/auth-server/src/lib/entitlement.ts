type EntitlementRow = {
  role: string | null;
  banned: unknown;
  banExpires: string | number | null;
  assigned: unknown;
};

function isTruthyFlag(value: unknown): boolean {
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    return value !== "" && value !== "0" && value.toLowerCase() !== "false";
  }
  return Boolean(value);
}

function parseExpiry(value: string | number): number | null {
  const numericValue = typeof value === "number" ? value : Number(value);
  if (Number.isFinite(numericValue) && String(value).trim() !== "") {
    return Math.abs(numericValue) < 1_000_000_000_000 ? numericValue * 1000 : numericValue;
  }

  const parsedValue = Date.parse(String(value));
  return Number.isNaN(parsedValue) ? null : parsedValue;
}

function isBanActive(row: EntitlementRow, now: number): boolean {
  if (!isTruthyFlag(row.banned)) return false;
  if (row.banExpires === null) return true;

  const expiresAt = parseExpiry(row.banExpires);
  return expiresAt !== null && expiresAt > now;
}

function isAdminRole(role: string | null): boolean {
  return role?.split(",").some((entry) => entry.trim() === "admin") ?? false;
}

export async function isEntitled(
  db: D1Database,
  userId: string,
  now: number = Date.now(),
): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT u.role AS role, u.banned AS banned, u.banExpires AS banExpires,
              EXISTS(
                SELECT 1 FROM bootstrap_user_profile b WHERE b.user_id = u.id
              ) AS assigned
       FROM "user" u
       WHERE u.id = ?`,
    )
    .bind(userId)
    .first<EntitlementRow>();

  if (!row || isBanActive(row, now)) return false;
  return isAdminRole(row.role) || isTruthyFlag(row.assigned);
}
