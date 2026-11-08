import type { OdooPolicy } from "@vortex/schema";
import { z } from "zod";

const identifier = /^[A-Za-z_][A-Za-z0-9_]*$/;
const sideEffectMethod = z.string().trim().min(1).max(256).refine((value) => {
  const lastDot = value.lastIndexOf(".");
  if (lastDot <= 0 || lastDot === value.length - 1) return false;
  const modelSegments = value.slice(0, lastDot).split(".");
  const method = value.slice(lastDot + 1);
  return modelSegments.length >= 2
    && modelSegments.every((segment) => identifier.test(segment))
    && identifier.test(method);
}, "expected exact Odoo model.method");

const policySchema = z.strictObject({
  policyVersion: z.literal(2),
  enableWrites: z.boolean(),
  allowedSideEffectMethods: z.array(sideEffectMethod).max(200),
});

const defaultPolicy: OdooPolicy = {
  policyVersion: 2,
  enableWrites: false,
  allowedSideEffectMethods: [],
};

export function parseOdooPolicy(
  value: unknown,
  options: { allowDefault?: boolean } = {},
): OdooPolicy {
  if (value === undefined && options.allowDefault) return structuredClone(defaultPolicy);
  const parsed = policySchema.parse(value);
  return {
    ...parsed,
    allowedSideEffectMethods: [...new Set(parsed.allowedSideEffectMethods)].sort(),
  };
}

export function parseBoundedJsonText(text: string, maxBytes = 65_536): unknown {
  if (new TextEncoder().encode(text).byteLength > maxBytes) throw new Error("payload_too_large");
  return JSON.parse(text) as unknown;
}
