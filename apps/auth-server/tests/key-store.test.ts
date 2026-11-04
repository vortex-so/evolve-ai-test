import { describe, expect, it, vi } from "vitest";
import { decryptSecret, encryptSecret } from "../src/lib/crypto";
import {
  getOrProvisionUserKey,
  getStoredKeyAlias,
  invalidateUserKey,
} from "../src/lib/key-store";
import { LitellmError, type LitellmClient } from "../src/lib/litellm";

const NOW = 1_730_678_400_000;
const SECRET = "test-wrapping-secret";
const USER = { id: "user-1", email: "person@example.com" };

type StoredKeyRow = {
  user_id: string;
  litellm_user_id: string;
  key_alias: string;
  token_id: string | null;
  key_ciphertext: string;
  key_iv: string;
  key_wrap_version: number;
  created_at: number;
  updated_at: number;
};

type FakeD1Result = {
  success: true;
  meta: {
    changes: number;
    last_row_id: number;
    duration: number;
    served_by: string;
  };
};

function result(changes: number): FakeD1Result {
  return {
    success: true,
    meta: {
      changes,
      last_row_id: 0,
      duration: 0,
      served_by: "key-store-test",
    },
  };
}

function normalize(sql: string): string {
  return sql.replace(/\s+/g, " ").trim().toLowerCase();
}

class KeyStoreD1 {
  row: StoredKeyRow | null = null;
  mcpRow: StoredKeyRow | null = null;
  forceNextInsertChangesZero = false;
  raceWinner: StoredKeyRow | null = null;

  get database(): D1Database {
    return this as unknown as D1Database;
  }

  prepare(sql: string) {
    const normalized = normalize(sql);
    return {
      bind: (...params: unknown[]) => ({
        first: async <T>() => this.first(normalized, params) as T | null,
        run: async () => this.run(normalized, params),
      }),
    };
  }

  private first(sql: string, params: unknown[]): unknown {
    if (
      sql.includes("from litellm_user_key where user_id = ?") ||
      sql.includes("from litellm_user_mcp_key where user_id = ?")
    ) {
      const row = sql.includes("litellm_user_mcp_key") ? this.mcpRow : this.row;
      if (!row || row.user_id !== params[0]) return null;
      if (sql.startsWith("select key_alias")) return { key_alias: row.key_alias };
      return {
        key_ciphertext: row.key_ciphertext,
        key_iv: row.key_iv,
        key_alias: row.key_alias,
      };
    }
    throw new Error(`Unsupported first() SQL: ${sql}`);
  }

  private run(sql: string, params: unknown[]): FakeD1Result {
    if (
      sql.startsWith("insert into litellm_user_key") ||
      sql.startsWith("insert into litellm_user_mcp_key")
    ) {
      const isMcp = sql.startsWith("insert into litellm_user_mcp_key");
      const existing = isMcp ? this.mcpRow : this.row;
      if (this.forceNextInsertChangesZero) {
        this.forceNextInsertChangesZero = false;
        if (isMcp) this.mcpRow = this.raceWinner;
        else this.row = this.raceWinner;
        return result(0);
      }
      if (existing) return result(0);
      const [
        userId,
        litellmUserId,
        keyAlias,
        tokenId,
        keyCiphertext,
        keyIv,
        keyWrapVersion,
        createdAt,
        updatedAt,
      ] = params;
      const inserted = {
        user_id: String(userId),
        litellm_user_id: String(litellmUserId),
        key_alias: String(keyAlias),
        token_id: tokenId === null ? null : String(tokenId),
        key_ciphertext: String(keyCiphertext),
        key_iv: String(keyIv),
        key_wrap_version: Number(keyWrapVersion),
        created_at: Number(createdAt),
        updated_at: Number(updatedAt),
      };
      if (isMcp) this.mcpRow = inserted;
      else this.row = inserted;
      return result(1);
    }

    if (
      sql.startsWith("delete from litellm_user_key where user_id = ?") ||
      sql.startsWith("delete from litellm_user_mcp_key where user_id = ?")
    ) {
      const isMcp = sql.startsWith("delete from litellm_user_mcp_key");
      const existing = isMcp ? this.mcpRow : this.row;
      if (!existing || existing.user_id !== params[0]) return result(0);
      if (isMcp) this.mcpRow = null;
      else this.row = null;
      return result(1);
    }

    throw new Error(`Unsupported run() SQL: ${sql}`);
  }
}

function createLitellmFake() {
  const findUserByEmail = vi.fn<LitellmClient["findUserByEmail"]>(async () => ({
    user_id: "litellm-user-1",
    user_email: USER.email,
  }));
  const createUser = vi.fn<LitellmClient["createUser"]>(async () => ({
    user_id: "created-litellm-user",
  }));
  const generateKey = vi.fn<LitellmClient["generateKey"]>(async () => ({
    key: "sk-generated",
    tokenId: "token-1",
  }));
  const deleteKeysByAlias = vi.fn<LitellmClient["deleteKeysByAlias"]>(async () => undefined);
  const client: LitellmClient = {
    findUserByEmail,
    createUser,
    generateKey,
    deleteKeysByAlias,
  };
  return { client, findUserByEmail, createUser, generateKey, deleteKeysByAlias };
}

function createDeps(db: KeyStoreD1, litellm: LitellmClient, secret = SECRET) {
  return {
    db: db.database,
    litellm,
    secret,
    mcpAccessGroup: "vortex-claude-desktop",
    now: () => NOW,
    nonce: () => "nonce123",
  };
}

async function storedRow(input: {
  plaintext: string;
  alias?: string;
  secret?: string;
  userId?: string;
  aad?: string;
}): Promise<StoredKeyRow> {
  const userId = input.userId ?? USER.id;
  const sealed = await encryptSecret(input.secret ?? SECRET, input.aad ?? userId, input.plaintext);
  return {
    user_id: userId,
    litellm_user_id: "litellm-user-1",
    key_alias: input.alias ?? "vortex-sso:user-1:stored",
    token_id: "stored-token",
    key_ciphertext: sealed.ciphertext,
    key_iv: sealed.iv,
    key_wrap_version: 1,
    created_at: NOW,
    updated_at: NOW,
  };
}

describe("key store", () => {
  it("provisions a key for an existing LiteLLM user matched by email", async () => {
    const db = new KeyStoreD1();
    const litellm = createLitellmFake();

    await expect(getOrProvisionUserKey(createDeps(db, litellm.client), USER, "inference")).resolves.toBe(
      "sk-generated",
    );
    expect(litellm.findUserByEmail).toHaveBeenCalledWith(USER.email);
    expect(litellm.createUser).not.toHaveBeenCalled();
    expect(litellm.generateKey).toHaveBeenCalledWith({
      userId: "litellm-user-1",
      keyAlias: "vortex-sso:user-1:nonce123",
      metadata: { source: "vortex-sso", vortex_user_id: USER.id },
      purpose: "inference",
    });
  });

  it("creates the LiteLLM user when no exact email match exists", async () => {
    const db = new KeyStoreD1();
    const litellm = createLitellmFake();
    litellm.findUserByEmail.mockResolvedValue(null);

    await getOrProvisionUserKey(createDeps(db, litellm.client), USER, "inference");

    expect(litellm.createUser).toHaveBeenCalledWith({
      userId: USER.id,
      email: USER.email,
      metadata: { source: "vortex-sso", vortex_user_id: USER.id },
    });
    expect(litellm.generateKey).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "created-litellm-user" }),
    );
  });

  it("recovers from a 409 on createUser by re-finding the user", async () => {
    const db = new KeyStoreD1();
    const litellm = createLitellmFake();
    litellm.findUserByEmail
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ user_id: "race-user", user_email: USER.email });
    litellm.createUser.mockRejectedValue(new LitellmError(409, "duplicate"));

    await getOrProvisionUserKey(createDeps(db, litellm.client), USER, "inference");

    expect(litellm.findUserByEmail).toHaveBeenCalledTimes(2);
    expect(litellm.generateKey).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "race-user" }),
    );
  });

  it("stores only ciphertext bound to the user id", async () => {
    const db = new KeyStoreD1();
    const litellm = createLitellmFake();

    await getOrProvisionUserKey(createDeps(db, litellm.client), USER, "inference");

    expect(db.row).not.toBeNull();
    expect(JSON.stringify(db.row)).not.toContain("sk-generated");
    await expect(
      decryptSecret(SECRET, USER.id, {
        ciphertext: db.row?.key_ciphertext ?? "",
        iv: db.row?.key_iv ?? "",
      }),
    ).resolves.toBe("sk-generated");
    await expect(
      decryptSecret(SECRET, "other-user", {
        ciphertext: db.row?.key_ciphertext ?? "",
        iv: db.row?.key_iv ?? "",
      }),
    ).rejects.toBeDefined();
  });

  it("returns the stored key without calling LiteLLM on later requests", async () => {
    const db = new KeyStoreD1();
    const litellm = createLitellmFake();
    const deps = createDeps(db, litellm.client);
    await getOrProvisionUserKey(deps, USER, "inference");

    await expect(getOrProvisionUserKey(deps, USER, "inference")).resolves.toBe("sk-generated");
    expect(litellm.findUserByEmail).toHaveBeenCalledTimes(1);
    expect(litellm.generateKey).toHaveBeenCalledTimes(1);
  });

  it("deletes the freshly generated LiteLLM key when storing it fails", async () => {
    const db = new KeyStoreD1();
    const litellm = createLitellmFake();
    const deps = { ...createDeps(db, litellm.client), secret: "" };

    await expect(getOrProvisionUserKey(deps, USER, "inference")).rejects.toThrow();
    expect(litellm.generateKey).toHaveBeenCalledTimes(1);
    expect(litellm.deleteKeysByAlias).toHaveBeenCalledWith(["vortex-sso:user-1:nonce123"]);
    expect(db.row).toBeFalsy();
  });

  it("race: losing insert deletes its own key and returns the winner's key", async () => {
    const db = new KeyStoreD1();
    db.forceNextInsertChangesZero = true;
    db.raceWinner = await storedRow({ plaintext: "sk-winner", alias: "winner-alias" });
    const litellm = createLitellmFake();
    litellm.generateKey.mockResolvedValue({ key: "sk-loser", tokenId: "loser-token" });

    await expect(getOrProvisionUserKey(createDeps(db, litellm.client), USER, "inference")).resolves.toBe(
      "sk-winner",
    );
    expect(litellm.deleteKeysByAlias).toHaveBeenCalledWith([
      "vortex-sso:user-1:nonce123",
    ]);
    expect(db.row?.key_alias).toBe("winner-alias");
  });

  it("re-provisions when the stored ciphertext cannot be decrypted", async () => {
    const db = new KeyStoreD1();
    db.row = await storedRow({ plaintext: "old-key", alias: "old-alias", secret: "old-secret" });
    const litellm = createLitellmFake();
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await expect(getOrProvisionUserKey(createDeps(db, litellm.client), USER, "inference")).resolves.toBe(
      "sk-generated",
    );
    expect(litellm.deleteKeysByAlias).toHaveBeenCalledWith(["old-alias"]);
    expect(db.row?.key_alias).toBe("vortex-sso:user-1:nonce123");
    expect(warning).toHaveBeenCalled();
    warning.mockRestore();
  });

  it("invalidateUserKey deletes the row and the LiteLLM key by alias", async () => {
    const db = new KeyStoreD1();
    db.row = await storedRow({ plaintext: "stored-key", alias: "stored-alias" });
    const litellm = createLitellmFake();

    await invalidateUserKey(createDeps(db, litellm.client), USER.id, "inference");

    expect(db.row).toBeNull();
    expect(litellm.deleteKeysByAlias).toHaveBeenCalledWith(["stored-alias"]);
  });

  it("invalidateUserKey tolerates LiteLLM failures", async () => {
    const db = new KeyStoreD1();
    db.row = await storedRow({ plaintext: "stored-key", alias: "stored-alias" });
    const litellm = createLitellmFake();
    litellm.deleteKeysByAlias.mockRejectedValue(new LitellmError(500, "unavailable"));
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await expect(invalidateUserKey(createDeps(db, litellm.client), USER.id, "inference")).resolves.toBeUndefined();
    expect(db.row).toBeNull();
    expect(warning).toHaveBeenCalled();
    warning.mockRestore();
  });

  it("getStoredKeyAlias returns the alias or null", async () => {
    const db = new KeyStoreD1();

    await expect(getStoredKeyAlias(db.database, USER.id, "inference")).resolves.toBeNull();
    db.row = await storedRow({ plaintext: "stored-key", alias: "stored-alias" });
    await expect(getStoredKeyAlias(db.database, USER.id, "inference")).resolves.toBe("stored-alias");
  });

  it("stores MCP keys in the MCP table with an MCP alias and purpose-specific AAD", async () => {
    const db = new KeyStoreD1();
    const litellm = createLitellmFake();

    await expect(getOrProvisionUserKey(createDeps(db, litellm.client), USER, "mcp")).resolves.toBe(
      "sk-generated",
    );

    expect(db.row).toBeNull();
    expect(db.mcpRow?.key_alias).toBe("vortex-sso-mcp:user-1:nonce123");
    expect(litellm.generateKey).toHaveBeenCalledWith({
      userId: "litellm-user-1",
      keyAlias: "vortex-sso-mcp:user-1:nonce123",
      metadata: { source: "vortex-sso", vortex_user_id: USER.id },
      purpose: "mcp",
      mcpAccessGroup: "vortex-claude-desktop",
    });
    await expect(
      decryptSecret(SECRET, `mcp:${USER.id}`, {
        ciphertext: db.mcpRow?.key_ciphertext ?? "",
        iv: db.mcpRow?.key_iv ?? "",
      }),
    ).resolves.toBe("sk-generated");
  });

  it("does not decrypt ciphertext from one key purpose as the other", async () => {
    const db = new KeyStoreD1();
    const litellm = createLitellmFake();
    db.mcpRow = await storedRow({
      plaintext: "inference-ciphertext",
      alias: "wrong-purpose",
      aad: USER.id,
    });
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await getOrProvisionUserKey(createDeps(db, litellm.client), USER, "mcp");

    expect(litellm.deleteKeysByAlias).toHaveBeenCalledWith(["wrong-purpose"]);
    expect(litellm.generateKey).toHaveBeenCalledTimes(1);
    warning.mockRestore();
  });
});
