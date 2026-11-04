import { decryptSecret, encryptSecret } from "./crypto";
import { LitellmError, type LitellmClient } from "./litellm";

export type KeyStoreDeps = {
  db: D1Database;
  litellm: LitellmClient;
  secret: string;
  now?: () => number;
  nonce?: () => string;
};

type StoredKeyRow = {
  key_ciphertext: string;
  key_iv: string;
  key_alias: string;
};

type StoredAliasRow = {
  key_alias: string;
};

const metadata = (userId: string) => ({
  source: "vortex-sso",
  vortex_user_id: userId,
});

async function readStoredKey(db: D1Database, userId: string): Promise<StoredKeyRow | null> {
  return db
    .prepare(
      "SELECT key_ciphertext, key_iv, key_alias FROM litellm_user_key WHERE user_id = ?",
    )
    .bind(userId)
    .first<StoredKeyRow>();
}

async function deleteKeyAliasBestEffort(
  litellm: LitellmClient,
  alias: string,
  userId: string,
): Promise<void> {
  try {
    await litellm.deleteKeysByAlias([alias]);
  } catch {
    console.warn("Failed to delete LiteLLM key alias", { userId });
  }
}

export async function getOrProvisionUserKey(
  deps: KeyStoreDeps,
  user: { id: string; email: string },
): Promise<string> {
  const stored = await readStoredKey(deps.db, user.id);
  if (stored) {
    try {
      return await decryptSecret(deps.secret, user.id, {
        ciphertext: stored.key_ciphertext,
        iv: stored.key_iv,
      });
    } catch {
      console.warn("Stored LiteLLM key could not be decrypted; re-provisioning", {
        userId: user.id,
      });
      await invalidateUserKey(deps, user.id);
    }
  }

  let litellmUser = await deps.litellm.findUserByEmail(user.email);
  let litellmUserId: string;
  if (litellmUser) {
    litellmUserId = litellmUser.user_id;
  } else {
    try {
      const created = await deps.litellm.createUser({
        userId: user.id,
        email: user.email,
        metadata: metadata(user.id),
      });
      litellmUserId = created.user_id;
    } catch (error) {
      if (!(error instanceof LitellmError) || error.status !== 409) throw error;
      litellmUser = await deps.litellm.findUserByEmail(user.email);
      if (!litellmUser) throw error;
      litellmUserId = litellmUser.user_id;
    }
  }

  const nonce = deps.nonce ?? (() => crypto.randomUUID().slice(0, 8));
  const alias = `vortex-sso:${user.id}:${nonce()}`;
  const generated = await deps.litellm.generateKey({
    userId: litellmUserId,
    keyAlias: alias,
    metadata: metadata(user.id),
  });
  let insertResult: D1Result;
  try {
    const sealed = await encryptSecret(deps.secret, user.id, generated.key);
    const timestamp = (deps.now ?? Date.now)();
    insertResult = await deps.db
      .prepare(
        `INSERT INTO litellm_user_key (
          user_id, litellm_user_id, key_alias, token_id, key_ciphertext, key_iv,
          key_wrap_version, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id) DO NOTHING`,
      )
      .bind(
        user.id,
        litellmUserId,
        alias,
        generated.tokenId,
        sealed.ciphertext,
        sealed.iv,
        1,
        timestamp,
        timestamp,
      )
      .run();
  } catch (error) {
    await deleteKeyAliasBestEffort(deps.litellm, alias, user.id);
    throw error;
  }

  if (insertResult.meta.changes !== 0) return generated.key;

  await deleteKeyAliasBestEffort(deps.litellm, alias, user.id);
  const winner = await readStoredKey(deps.db, user.id);
  if (!winner) {
    throw new Error("LiteLLM key insert lost a race but no stored winner was found");
  }
  return decryptSecret(deps.secret, user.id, {
    ciphertext: winner.key_ciphertext,
    iv: winner.key_iv,
  });
}

export async function invalidateUserKey(deps: KeyStoreDeps, userId: string): Promise<void> {
  const alias = await getStoredKeyAlias(deps.db, userId);
  await deps.db.prepare("DELETE FROM litellm_user_key WHERE user_id = ?").bind(userId).run();
  if (alias) await deleteKeyAliasBestEffort(deps.litellm, alias, userId);
}

export async function getStoredKeyAlias(
  db: D1Database,
  userId: string,
): Promise<string | null> {
  const row = await db
    .prepare("SELECT key_alias FROM litellm_user_key WHERE user_id = ?")
    .bind(userId)
    .first<StoredAliasRow>();
  return row?.key_alias ?? null;
}
