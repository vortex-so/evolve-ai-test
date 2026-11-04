import { consentRequiredPaths, validateBootstrapConfig } from "@vortex/schema";

/**
 * Client-side hint validation. This is only a hint: the authoritative check is
 * the server-side `validateBootstrapConfig` call in the admin BFF. We delegate
 * to the exact same shared validator here so the editor and the server agree on
 * which keys are official.
 */
export function validateBootstrapConfigHint(
  input: unknown,
): Array<{ path: string; message: string }> {
  const result = validateBootstrapConfig(input);
  if (result.ok) {
    return [];
  }

  return result.errors;
}

/**
 * Paths whose values trigger Claude Desktop's "Apply settings from your
 * organization?" consent dialog, derived from `x-consentRequired` in the
 * official schema. Returns [] for anything that is not a plain config object.
 */
export function consentRequiredKeys(input: unknown): string[] {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return [];
  }

  return consentRequiredPaths(input);
}
