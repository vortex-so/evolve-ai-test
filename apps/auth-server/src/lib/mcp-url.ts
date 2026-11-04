const SERVER_NAME_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export function parseGatewayMcpUrl(publicOrigin: string, rawUrl: string): string | null {
  let canonicalOrigin: string;
  let parsed: URL;
  try {
    canonicalOrigin = new URL(publicOrigin).origin;
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }

  if (
    parsed.origin !== canonicalOrigin ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.search !== "" ||
    parsed.hash !== "" ||
    parsed.href !== rawUrl
  ) {
    return null;
  }

  const match = /^\/mcp\/([A-Za-z0-9_-]{1,64})$/.exec(parsed.pathname);
  const server = match?.[1];
  if (!server || !SERVER_NAME_PATTERN.test(server)) return null;
  return rawUrl === `${canonicalOrigin}/mcp/${server}` ? server : null;
}
