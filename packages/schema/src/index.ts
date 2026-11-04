/**
 * Shared type vocabulary across apps.
 *
 * Kept intentionally small: only shapes that cross package boundaries live
 * here. App-internal types stay in the app that owns them.
 */

export type BootstrapConfig = {
  $schema?: string;
  inferenceProvider: "gateway" | "anthropic" | "bedrock" | "vertex" | "foundry";
  inferenceGatewayBaseUrl?: string;
  inferenceGatewayAuthScheme?: "bearer" | "x-api-key";
  inferenceCredentialKind?: "static" | "interactive" | "oauth" | "workforce";
  inferenceModels?: Array<
    | string
    | {
        name: string;
        labelOverride?: string;
        supports1m?: boolean;
        prefer1m?: boolean;
        anthropicFamilyTier?: "sonnet" | "opus" | "haiku" | "fable" | "mythos";
        isFamilyDefault?: boolean;
      }
  >;
  coworkEgressAllowedHosts?: string[];
  managedMcpServers?: Array<{
    name: string;
    url?: string;
    transport?: "sse" | "http" | "stdio";
    command?: string;
    args?: string[];
  }>;
  otlpResourceAttributes?: Record<string, string>;
  /** Unix epoch (seconds or ms; >= 1e12 read as ms). Client caches until this instant. */
  expiresAt?: number;
};
