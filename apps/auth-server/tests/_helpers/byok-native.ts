export const NATIVE_ODOO_POLICY = {
  policyVersion: 2,
  enableWrites: true,
  allowedSideEffectMethods: [
    "project.task.create",
    "project.task.write",
  ],
} as const;

export const NATIVE_ODOO_DEFAULT_POLICY = {
  policyVersion: 2,
  enableWrites: false,
  allowedSideEffectMethods: [],
} as const;

export const LEGACY_ODOO_POLICY = {
  readProjects: true,
  readTasks: true,
  createTasks: true,
  updateTasks: true,
  allowedProjectIds: [7, 9],
  writableFields: ["name", "description", "date_deadline", "priority"],
} as const;

export function nativeConnectionRow(
  sealed: { ciphertext: string; iv: string },
  overrides: Record<string, unknown> = {},
) {
  return {
    id: "conn-native-1",
    user_id: "plain-user-id",
    provider: "odoo",
    base_url: "https://erp.vortex.so",
    database_name: "vortex",
    login: "user@example.com",
    credential_ciphertext: sealed.ciphertext,
    credential_iv: sealed.iv,
    enabled: 1,
    version: 7,
    tested_version: 7,
    tested_at: 1_800_000_000_000,
    test_status: "ok",
    odoo_uid: 17,
    policy_json: JSON.stringify(NATIVE_ODOO_POLICY),
    deleted_at: null,
    mutation_nonce: "native-nonce",
    created_at: 1,
    updated_at: 2,
    ...overrides,
  };
}
