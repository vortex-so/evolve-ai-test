import { Validator, type OutputUnit, type Schema } from "@cfworker/json-schema";

import vendoredSchema from "../schemas/bootstrap-config-v1.schema.json";
import type { BootstrapConfig } from "./index";

export const BOOTSTRAP_SCHEMA_VERSION = 1 as const;
export const BOOTSTRAP_CONFIG_V1_SCHEMA_URL =
  "https://claude.com/docs/third-party/claude-desktop/schemas/bootstrap-config-v1.schema.json";

type ValidationError = { path: string; message: string };
type SchemaObject = Record<string, unknown>;

const V2_ONLY_CLUSTER_KEYS = [
  // Source: https://claude.com/docs/third-party/claude-desktop/schemas/bootstrap-config-v2.schema.json
  "appearance",
  "authentication",
  "autoUpdate",
  "builtinBrowser",
  "chatSurface",
  "codeSurface",
  "coworkSurface",
  "extensions",
  "featureDiscovery",
  "inference",
  "lifecycle",
  "mcp",
  "models",
  "otlp",
  "plugins",
  "sessionRetention",
  "telemetry",
  "tokenLimits",
  "workspace",
] as const;

const bootstrapConfigSchema = vendoredSchema.definitions.BootstrapConfig;
const overlaidBootstrapConfigSchema = {
  ...bootstrapConfigSchema,
  properties: {
    ...bootstrapConfigSchema.properties,
    $schema: { type: "string" },
    $schemaVersion: { type: "number", const: BOOTSTRAP_SCHEMA_VERSION },
  },
  additionalProperties: false,
  required: ["inferenceProvider"],
};

const overlaidSchema: Schema = {
  ...vendoredSchema,
  definitions: {
    ...vendoredSchema.definitions,
    BootstrapConfig: overlaidBootstrapConfigSchema,
  },
};

const validator = new Validator(overlaidSchema, "7", false);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasOwn(object: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function isNestedV2(config: Record<string, unknown>): boolean {
  return (
    config.$schemaVersion === 2 ||
    V2_ONLY_CLUSTER_KEYS.some((key) => hasOwn(config, key))
  );
}

function decodePointerToken(token: string): string {
  return token.replaceAll("~1", "/").replaceAll("~0", "~");
}

function pointerToPath(pointer: string): string {
  if (pointer === "#" || pointer === "") {
    return "";
  }

  return pointer
    .replace(/^#\/?/, "")
    .split("/")
    .map(decodePointerToken)
    .join(".");
}

function requiredProperty(error: OutputUnit): string | undefined {
  if (error.keyword !== "required") {
    return undefined;
  }

  return /required property "([^"]+)"/.exec(error.error)?.[1];
}

function additionalProperty(error: OutputUnit): string | undefined {
  if (error.keyword !== "additionalProperties") {
    return undefined;
  }

  return /Property "([^"]+)"/.exec(error.error)?.[1];
}

function joinPath(parent: string, child: string): string {
  return parent ? `${parent}.${child}` : child;
}

function isAncestorPath(parent: string, child: string): boolean {
  return parent === "" ? child !== "" : child.startsWith(`${parent}.`);
}

const SUMMARY_KEYWORDS = new Set([
  "$ref",
  "properties",
  "patternProperties",
  "items",
  "prefixItems",
  "additionalItems",
  "allOf",
  "if",
  "dependentSchemas",
  "dependencies",
]);

function mapValidationErrors(errors: OutputUnit[]): ValidationError[] {
  const unknownKeys = new Map<string, ValidationError>();
  for (const error of errors) {
    const key = additionalProperty(error);
    if (key !== undefined) {
      const path = joinPath(pointerToPath(error.instanceLocation), key);
      unknownKeys.set(path, { path, message: `Unknown key "${key}"` });
    }
  }

  const candidates: Array<ValidationError & { keyword: string }> = [];
  for (const error of errors) {
    const parentPath = pointerToPath(error.instanceLocation);
    const missingKey = requiredProperty(error);
    const path =
      missingKey === undefined ? parentPath : joinPath(parentPath, missingKey);

    if (error.keyword === "additionalProperties") {
      continue;
    }
    if (error.keyword === "false" && unknownKeys.has(path)) {
      continue;
    }

    candidates.push({ path, message: error.error, keyword: error.keyword });
  }

  for (const error of unknownKeys.values()) {
    candidates.push({ ...error, keyword: "additionalProperties" });
  }

  const deepestCandidates = candidates.filter(
    (candidate) =>
      !candidates.some(
        (other) =>
          other !== candidate && isAncestorPath(candidate.path, other.path),
      ),
  );

  const byPath = new Map<string, typeof deepestCandidates>();
  for (const candidate of deepestCandidates) {
    const atPath = byPath.get(candidate.path) ?? [];
    atPath.push(candidate);
    byPath.set(candidate.path, atPath);
  }

  const mapped: ValidationError[] = [];
  for (const atPath of byPath.values()) {
    const unionSummary = atPath.find(
      (error) => error.keyword === "anyOf" || error.keyword === "oneOf",
    );
    const concrete = atPath.filter(
      (error) =>
        !SUMMARY_KEYWORDS.has(error.keyword) &&
        error.keyword !== "anyOf" &&
        error.keyword !== "oneOf",
    );
    const selected = unionSummary ? [unionSummary] : concrete.slice(0, 1);
    mapped.push(...selected.map(({ path, message }) => ({ path, message })));
  }

  const deduplicated = new Map<string, ValidationError>();
  for (const error of mapped) {
    deduplicated.set(`${error.path}\u0000${error.message}`, error);
  }

  return [...deduplicated.values()].sort(
    (left, right) =>
      left.path.localeCompare(right.path) ||
      left.message.localeCompare(right.message),
  );
}

export function validateBootstrapConfig(
  input: unknown,
):
  | { ok: true; data: BootstrapConfig }
  | { ok: false; errors: ValidationError[] } {
  if (!isPlainObject(input)) {
    return {
      ok: false,
      errors: [{ path: "", message: "Config must be a JSON object" }],
    };
  }

  if (isNestedV2(input)) {
    return {
      ok: false,
      errors: [
        {
          path: "",
          message: "Nested v2 format is not supported; use flat v1 keys",
        },
      ],
    };
  }

  const result = validator.validate(input);
  if (!result.valid) {
    return { ok: false, errors: mapValidationErrors(result.errors) };
  }

  return { ok: true, data: input as BootstrapConfig };
}

function isSchemaObject(value: unknown): value is SchemaObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function resolveLocalRef(ref: string): unknown {
  if (!ref.startsWith("#/")) {
    return undefined;
  }

  let current: unknown = overlaidSchema;
  for (const token of ref.slice(2).split("/").map(decodePointerToken)) {
    if (!isSchemaObject(current) || !hasOwn(current, token)) {
      return undefined;
    }
    current = current[token];
  }
  return current;
}

function expandSchemaNodes(
  schemaNodes: readonly unknown[],
  visited = new Set<SchemaObject>(),
): SchemaObject[] {
  const expanded: SchemaObject[] = [];

  for (const node of schemaNodes) {
    if (!isSchemaObject(node) || visited.has(node)) {
      continue;
    }
    visited.add(node);
    expanded.push(node);

    if (typeof node.$ref === "string") {
      expanded.push(...expandSchemaNodes([resolveLocalRef(node.$ref)], visited));
    }

    for (const keyword of ["allOf", "anyOf", "oneOf"] as const) {
      const branches = node[keyword];
      if (Array.isArray(branches)) {
        expanded.push(...expandSchemaNodes(branches, visited));
      }
    }
  }

  return expanded;
}

function propertySchemas(nodes: readonly SchemaObject[], key: string): unknown[] {
  const schemas: unknown[] = [];
  for (const node of nodes) {
    if (isSchemaObject(node.properties) && hasOwn(node.properties, key)) {
      schemas.push(node.properties[key]);
    }
  }
  return schemas;
}

function itemSchemas(nodes: readonly SchemaObject[], index: number): unknown[] {
  const schemas: unknown[] = [];
  for (const node of nodes) {
    if (Array.isArray(node.items)) {
      if (index < node.items.length) {
        schemas.push(node.items[index]);
      }
    } else if (node.items !== undefined) {
      schemas.push(node.items);
    }
  }
  return schemas;
}

function walkConsentPaths(
  value: unknown,
  schemaNodes: readonly unknown[],
  path: string,
  paths: Set<string>,
): void {
  const expanded = expandSchemaNodes(schemaNodes);
  if (
    path !== "" &&
    expanded.some((schema) => schema["x-consentRequired"] === true)
  ) {
    paths.add(path);
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      walkConsentPaths(
        item,
        itemSchemas(expanded, index),
        joinPath(path, String(index)),
        paths,
      );
    });
    return;
  }

  if (!isPlainObject(value)) {
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    walkConsentPaths(
      child,
      propertySchemas(expanded, key),
      joinPath(path, key),
      paths,
    );
  }
}

export function consentRequiredPaths(config: unknown): string[] {
  if (!isPlainObject(config)) {
    return [];
  }

  const paths = new Set<string>();
  walkConsentPaths(config, [overlaidSchema], "", paths);
  return [...paths].sort();
}
