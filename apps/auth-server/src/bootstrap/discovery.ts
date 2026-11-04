/**
 * RFC 8414 discovery document.
 *
 * Two independent surfaces need this:
 *   1. Bootstrap fetch    — Claude Desktop derives the issuer by stripping
 *      trailing /bootstrap or /user/bootstrap from `bootstrapUrl`, then GETs
 *      <issuer>/.well-known/oauth-authorization-server.
 *   2. Gateway SSO        — When `inferenceGatewayBaseUrl` shares the bootstrap
 *      origin and `inferenceCredentialKind=interactive`, Claude Desktop looks
 *      for gateway metadata at <inferenceGatewayBaseUrl>/.well-known/... too.
 *      With our /v1 gateway base URL, that's <origin>/v1/.well-known/... —
 *      and RFC 8414 requires the `issuer` in the doc to match the fetch base.
 *
 * `pathPrefix` lets the caller emit either the root variant (issuer=origin,
 * endpoints at /oauth/*) or the /v1 gateway variant (issuer=origin/v1,
 * endpoints at /v1/oauth/*).
 */
export function buildDiscoveryMetadata(origin: string, pathPrefix: "" | "/v1" = "") {
  const base = origin + pathPrefix;
  return {
    issuer: base,
    token_endpoint: `${base}/oauth/token`,
    device_authorization_endpoint: `${base}/oauth/device`,
    jwks_uri: `${origin}/api/auth/jwks`,
    grant_types_supported: ["urn:ietf:params:oauth:grant-type:device_code"],
    token_endpoint_auth_methods_supported: ["none"],
    response_types_supported: ["token"],
    code_challenge_methods_supported: ["S256"],
  } as const;
}
