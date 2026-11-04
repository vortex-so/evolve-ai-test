export const OAUTH_SCOPE_OPTIONS = [
  "openid",
  "profile",
  "email",
  "offline_access",
  "bootstrap:read",
] as const;

export const OAUTH_GRANT_TYPE_OPTIONS = [
  "authorization_code",
  "refresh_token",
  "device_code",
] as const;

export const OAUTH_RESPONSE_TYPE_OPTIONS = ["code"] as const;

export const TOKEN_ENDPOINT_AUTH_METHOD_OPTIONS = [
  "client_secret_basic",
  "client_secret_post",
  "none",
] as const;

export type OAuthScopeOption = (typeof OAUTH_SCOPE_OPTIONS)[number];
export type OAuthGrantTypeOption = (typeof OAUTH_GRANT_TYPE_OPTIONS)[number];
export type OAuthResponseTypeOption = (typeof OAUTH_RESPONSE_TYPE_OPTIONS)[number];
export type TokenEndpointAuthMethodOption =
  (typeof TOKEN_ENDPOINT_AUTH_METHOD_OPTIONS)[number];

export type OAuthClient = {
  id: string;
  clientId: string;
  name: string;
  uri: string;
  logoUri: string;
  redirectUris: string[];
  scopes: string[];
  grantTypes: string[];
  responseTypes: string[];
  tokenEndpointAuthMethod: string;
  requirePKCE: boolean;
  isSystem: boolean;
  publicClient: boolean;
  disabled: boolean;
  createdAt: string | number | null;
  updatedAt: string | number | null;
  raw: Record<string, unknown>;
};

export type OAuthClientsResponse = {
  rows?: unknown[];
  items?: unknown[];
};

export type OAuthConsent = {
  id: string;
  userId: string | null;
  userEmail: string | null;
  scopes: string[];
  grantedAt: string | number | null;
};

type UnknownRecord = Record<string, unknown>;

function toRecord(value: unknown): UnknownRecord {
  return typeof value === "object" && value !== null ? (value as UnknownRecord) : {};
}

function toString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function toBoolean(value: unknown): boolean {
  return value === true || value === 1 || value === "1";
}

function parseJsonArray(value: string): string[] | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) {
      return null;
    }

    return parsed.map((item) => String(item)).filter(Boolean);
  } catch {
    return null;
  }
}

export function parseArrayish(value: unknown, separator = ","): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }

  if (typeof value !== "string") {
    return [];
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return [];
  }

  if (trimmed.startsWith("[")) {
    return parseJsonArray(trimmed) ?? [];
  }

  if (separator === " ") {
    return trimmed.split(/\s+/).map((item) => item.trim()).filter(Boolean);
  }

  return trimmed
    .split(separator)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function mapGrantTypeFromApi(value: string): string {
  return value === "urn:ietf:params:oauth:grant-type:device_code" ? "device_code" : value;
}

export function mapGrantTypeToApi(value: string): string {
  return value === "device_code" ? "urn:ietf:params:oauth:grant-type:device_code" : value;
}

export function normalizeOAuthClient(input: unknown): OAuthClient {
  const record = toRecord(input);
  const scopes = parseArrayish(record.scopes, " ");
  const grantTypes = parseArrayish(record.grantTypes, " ").map(mapGrantTypeFromApi);
  const responseTypes = parseArrayish(record.responseTypes, " ");

  return {
    id: toString(record.id) || toString(record.clientId),
    clientId: toString(record.clientId) || toString(record.client_id),
    name: toString(record.name),
    uri: toString(record.uri) || toString(record.client_uri),
    logoUri: toString(record.logoUri) || toString(record.logo_uri) || toString(record.icon),
    redirectUris: parseArrayish(record.redirectUris),
    scopes,
    grantTypes,
    responseTypes,
    tokenEndpointAuthMethod:
      toString(record.tokenEndpointAuthMethod) ||
      toString(record.token_endpoint_auth_method) ||
      "client_secret_basic",
    requirePKCE: toBoolean(record.requirePKCE ?? record.require_pkce),
    isSystem: toBoolean(record.is_system ?? record.isSystem),
    publicClient: toBoolean(record.public),
    disabled: toBoolean(record.disabled),
    createdAt:
      (record.createdAt as string | number | null | undefined) ??
      (record.created_at as string | number | null | undefined) ??
      null,
    updatedAt:
      (record.updatedAt as string | number | null | undefined) ??
      (record.updated_at as string | number | null | undefined) ??
      null,
    raw: record,
  };
}

export function normalizeOAuthClientsResponse(payload: OAuthClientsResponse): OAuthClient[] {
  const source = payload.items ?? payload.rows ?? [];
  return source.map((item) => normalizeOAuthClient(item));
}

export function extractClientSecret(payload: unknown): string | null {
  const record = toRecord(payload);
  const nestedClient = toRecord(record.client);
  const nestedData = toRecord(record.data);

  return (
    toString(record.client_secret) ||
    toString(record.clientSecret) ||
    toString(record.secret) ||
    toString(nestedClient.client_secret) ||
    toString(nestedClient.clientSecret) ||
    toString(nestedData.client_secret) ||
    toString(nestedData.clientSecret) ||
    null
  );
}
