import type { BootstrapConfig } from "@vortex/schema";
import { z } from "zod";

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

export const bootstrapConfigHintSchema = z
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

const _assignable: z.infer<typeof bootstrapConfigHintSchema> = null as unknown as BootstrapConfig;
void _assignable;

export function validateBootstrapConfigHint(input: unknown): Array<{ path: string; message: string }> {
  const parsed = bootstrapConfigHintSchema.safeParse(input);
  if (parsed.success) {
    return [];
  }

  return parsed.error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));
}
