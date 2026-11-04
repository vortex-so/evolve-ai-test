import { z } from "zod";
import type { BootstrapConfig } from "@vortex/schema";

/**
 * Phase 4 write-time Zod schema for a bootstrap profile's `config` blob.
 *
 * MIRRORS `BootstrapConfig` from @vortex/schema — the shape Claude Desktop
 * accepts. Anything console writes must pass this before persistence so a bad
 * profile can never break Claude Desktop bootstrap.
 *
 * Phase 5 will tighten: per-provider required-field enforcement, host
 * pattern validation, MCP transport-specific field coupling.
 */

const inferenceModelSchema = z.union([
  z.string().min(1),
  z.object({
    name: z.string().min(1),
    labelOverride: z.string().optional(),
    supports1m: z.boolean().optional(),
    prefer1m: z.boolean().optional(),
    anthropicFamilyTier: z
      .enum(["sonnet", "opus", "haiku", "fable", "mythos"])
      .optional(),
    isFamilyDefault: z.boolean().optional(),
  }),
]);

const managedMcpServerSchema = z.object({
  name: z.string().min(1),
  url: z.string().url().optional(),
  transport: z.enum(["sse", "http", "stdio"]).optional(),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
});

export const bootstrapConfigSchema = z
  .object({
    $schema: z.string().optional(),
    inferenceProvider: z.enum([
      "gateway",
      "anthropic",
      "bedrock",
      "vertex",
      "foundry",
    ]),
    inferenceGatewayBaseUrl: z.string().url().optional(),
    inferenceGatewayAuthScheme: z.enum(["bearer", "x-api-key"]).optional(),
    inferenceCredentialKind: z
      .enum(["static", "interactive", "oauth", "workforce"])
      .optional(),
    inferenceModels: z.array(inferenceModelSchema).min(1).optional(),
    coworkEgressAllowedHosts: z.array(z.string().min(1)).optional(),
    managedMcpServers: z.array(managedMcpServerSchema).optional(),
    otlpResourceAttributes: z.record(z.string(), z.string()).optional(),
    expiresAt: z.number().int().positive().optional(),
  })
  .strict();

export type ValidatedBootstrapConfig = z.infer<typeof bootstrapConfigSchema>;

const _assignable: ValidatedBootstrapConfig = null as unknown as BootstrapConfig;
void _assignable;

export function validateBootstrapConfig(input: unknown): {
  ok: true;
  data: ValidatedBootstrapConfig;
} | {
  ok: false;
  errors: Array<{ path: string; message: string }>;
} {
  const parsed = bootstrapConfigSchema.safeParse(input);
  if (parsed.success) return { ok: true, data: parsed.data };
  return {
    ok: false,
    errors: parsed.error.issues.map((i: z.core.$ZodIssue) => ({
      path: i.path.join("."),
      message: i.message,
    })),
  };
}
