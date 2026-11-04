/**
 * Shared type vocabulary across apps.
 *
 * Kept intentionally small: only shapes that cross package boundaries live
 * here. App-internal types stay in the app that owns them.
 */

export type BootstrapConfig = {
  $schema?: string;
  $schemaVersion?: 1;
  inferenceProvider:
    | "gateway"
    | "anthropic"
    | "bedrock"
    | "mantle"
    | "vertex"
    | "foundry";
  inferenceGatewayBaseUrl?: string;
  inferenceGatewayAuthScheme?: "bearer" | "x-api-key";
  inferenceCredentialKind?:
    | "static"
    | "helper-script"
    | "interactive"
    | "vendor-profile"
    | "workforce"
    | "external-idp";
  inferenceModels?: Array<
    | string
    | {
        name: string;
        labelOverride?: string;
        supports1m?: boolean;
        prefer1m?: boolean;
        anthropicFamilyTier?: "sonnet" | "opus" | "haiku" | "fable" | "mythos";
        isFamilyDefault?: boolean;
        behavesAs?: string;
        maxEffort?: "low" | "medium" | "high" | "xhigh" | "max";
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
  [key: string]: unknown;
};

export * from "./validate";
