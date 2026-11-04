/**
 * RFC 8414 discovery document.
 *
 * Claude Desktop derives the issuer from the bootstrap origin and uses this
 * root metadata for both bootstrap and gateway authentication.
 */
export function buildDiscoveryMetadata(origin: string) {
  return {
    issuer: origin,
    token_endpoint: `${origin}/oauth/token`,
    device_authorization_endpoint: `${origin}/oauth/device`,
    jwks_uri: `${origin}/api/auth/jwks`,
    grant_types_supported: ["urn:ietf:params:oauth:grant-type:device_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["none"],
    response_types_supported: ["token"],
    code_challenge_methods_supported: ["S256"],
  } as const;
}
