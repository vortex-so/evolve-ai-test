import { SignJWT, importPKCS8 } from "jose";
import { describe, expect, it } from "vitest";
import { mintByokAssertion, verifyByokAssertion } from "../src/byok/identity";
import { generateByokTestKeys } from "./_helpers/byok-keys";

describe("BYOK signed identity", () => {
  it("mints and verifies the exact ES256 MCP claim contract", async () => {
    const key = await generateByokTestKeys();
    const token = await mintByokAssertion({
      privateKeyPem: key.privateKey,
      issuer: "https://api.auth-dev.vortex.so",
      subject: "user-1",
      connectionId: "conn-1",
      version: 4,
      purpose: "mcp",
      server: "odoo",
      now: 1_800_000_000,
    });

    await expect(verifyByokAssertion({
      token,
      publicKeyPem: key.publicKey,
      issuer: "https://api.auth-dev.vortex.so",
      now: 1_800_000_010,
    })).resolves.toMatchObject({
      sub: "user-1",
      connectionId: "conn-1",
      version: 4,
      purpose: "mcp",
      server: "odoo",
    });
  });

  it("rejects a wrong audience", async () => {
    const key = await generateByokTestKeys();
    const privateKey = await importPKCS8(key.privateKey, "ES256");
    const base = new SignJWT({
      connection_id: "conn-1",
      version: 1,
      purpose: "mcp",
      server: "odoo_test",
    })
      .setProtectedHeader({ alg: "ES256" })
      .setIssuer("https://api.auth-dev.vortex.so")
      .setAudience("wrong-audience")
      .setSubject("user-1")
      .setIssuedAt(1_800_000_000)
      .setExpirationTime(1_800_000_030)
      .setJti("jti-1");
    const token = await base.sign(privateKey);

    await expect(verifyByokAssertion({
      token,
      publicKeyPem: key.publicKey,
      issuer: "https://api.auth-dev.vortex.so",
      now: 1_800_000_010,
    })).rejects.toThrow();
  });

  it("rejects a non-ES256 algorithm", async () => {
    const key = await generateByokTestKeys();
    const token = await new SignJWT({
      connection_id: "conn-1", version: 1, purpose: "mcp", server: "odoo",
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer("https://api.auth-dev.vortex.so")
      .setAudience("vortex-odoo-adapter")
      .setSubject("user-1")
      .setIssuedAt(1_800_000_000)
      .setExpirationTime(1_800_000_030)
      .setJti("jti-hs")
      .sign(new TextEncoder().encode("a-secret-long-enough-for-hs256-tests"));
    await expect(verifyByokAssertion({
      token, publicKeyPem: key.publicKey, issuer: "https://api.auth-dev.vortex.so", now: 1_800_000_010,
    })).rejects.toThrow();
  });

  it.each([
    [{ connection_id: "conn-1", version: 1, purpose: "mcp", server: "odoo_test" }, "mismatched purpose"],
    [{ connection_id: "conn-1", version: 0, purpose: "mcp", server: "odoo" }, "invalid version"],
  ] as const)("rejects %s", async (claims, _reason) => {
    const key = await generateByokTestKeys();
    const privateKey = await importPKCS8(key.privateKey, "ES256");
    const token = await new SignJWT(claims)
      .setProtectedHeader({ alg: "ES256" })
      .setIssuer("https://api.auth-dev.vortex.so")
      .setAudience("vortex-odoo-adapter")
      .setSubject("user-1")
      .setIssuedAt(1_800_000_000)
      .setExpirationTime(1_800_000_030)
      .setJti("jti-invalid")
      .sign(privateKey);
    await expect(verifyByokAssertion({
      token, publicKeyPem: key.publicKey, issuer: "https://api.auth-dev.vortex.so", now: 1_800_000_010,
    })).rejects.toThrow();
  });

  it("requires actor_id only for test assertions", async () => {
    const key = await generateByokTestKeys();
    await expect(mintByokAssertion({
      privateKeyPem: key.privateKey,
      issuer: "https://api.auth-dev.vortex.so",
      subject: "user-1",
      connectionId: "conn-1",
      version: 1,
      purpose: "test",
      server: "odoo_test",
    })).rejects.toThrow();
  });
});
