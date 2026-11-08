import { SignJWT, importPKCS8, importSPKI, jwtVerify, type JWTPayload } from "jose";

export type ByokAssertion = {
  sub: string;
  connectionId: string;
  version: number;
  purpose: "mcp" | "test";
  server: "odoo" | "odoo_test";
  actorId?: string;
  jti: string;
  iat: number;
  exp: number;
};

type MintInput = {
  privateKeyPem: string;
  issuer: string;
  subject: string;
  connectionId: string;
  version: number;
  purpose: "mcp" | "test";
  server: "odoo" | "odoo_test";
  actorId?: string;
  now?: number;
};

function validatePairing(purpose: "mcp" | "test", server: "odoo" | "odoo_test", actorId?: string): void {
  if (purpose === "mcp" && (server !== "odoo" || actorId !== undefined)) throw new Error("invalid mcp assertion");
  if (purpose === "test" && (server !== "odoo_test" || !actorId)) throw new Error("invalid test assertion");
}

export async function mintByokAssertion(input: MintInput): Promise<string> {
  validatePairing(input.purpose, input.server, input.actorId);
  if (!Number.isInteger(input.version) || input.version < 1) throw new Error("invalid version");
  const now = input.now ?? Math.floor(Date.now() / 1000);
  const key = await importPKCS8(input.privateKeyPem, "ES256");
  return new SignJWT({
    connection_id: input.connectionId,
    version: input.version,
    purpose: input.purpose,
    server: input.server,
    ...(input.actorId ? { actor_id: input.actorId } : {}),
  })
    .setProtectedHeader({ alg: "ES256", typ: "JWT" })
    .setIssuer(input.issuer)
    .setAudience("vortex-odoo-adapter")
    .setSubject(input.subject)
    .setIssuedAt(now)
    .setExpirationTime(now + 60)
    .setJti(crypto.randomUUID())
    .sign(key);
}

function stringClaim(payload: JWTPayload, name: string): string {
  const value = payload[name];
  if (typeof value !== "string" || value.length === 0) throw new Error(`invalid ${name}`);
  return value;
}

export async function verifyByokAssertion(input: {
  token: string;
  publicKeyPem: string;
  issuer: string;
  now?: number;
}): Promise<ByokAssertion> {
  const now = input.now ?? Math.floor(Date.now() / 1000);
  const key = await importSPKI(input.publicKeyPem, "ES256");
  const { payload } = await jwtVerify(input.token, key, {
    algorithms: ["ES256"],
    issuer: input.issuer,
    audience: "vortex-odoo-adapter",
    requiredClaims: ["sub", "iat", "exp", "jti", "connection_id", "version", "purpose", "server"],
    currentDate: new Date(now * 1000),
  });
  const purpose = stringClaim(payload, "purpose");
  const server = stringClaim(payload, "server");
  if ((purpose !== "mcp" && purpose !== "test") || (server !== "odoo" && server !== "odoo_test")) {
    throw new Error("invalid assertion scope");
  }
  const actorId = payload.actor_id;
  if (actorId !== undefined && typeof actorId !== "string") throw new Error("invalid actor_id");
  validatePairing(purpose, server, actorId);
  if (typeof payload.version !== "number" || !Number.isInteger(payload.version) || payload.version < 1) {
    throw new Error("invalid version");
  }
  if (
    typeof payload.iat !== "number" || typeof payload.exp !== "number"
    || payload.iat > now || payload.exp <= payload.iat || payload.exp - payload.iat > 60
  ) {
    throw new Error("invalid assertion lifetime");
  }
  return {
    sub: stringClaim(payload, "sub"),
    connectionId: stringClaim(payload, "connection_id"),
    version: payload.version,
    purpose,
    server,
    ...(actorId ? { actorId } : {}),
    jti: stringClaim(payload, "jti"),
    iat: payload.iat,
    exp: payload.exp,
  };
}
