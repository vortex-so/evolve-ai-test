export class LitellmError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly type?: string,
  ) {
    super(message);
    this.name = "LitellmError";
  }
}

export type LitellmClient = {
  findUserByEmail(email: string): Promise<{ user_id: string; user_email: string } | null>;
  createUser(input: {
    userId: string;
    email: string;
    metadata?: Record<string, string>;
  }): Promise<{ user_id: string }>;
  generateKey(input: {
    userId: string;
    keyAlias: string;
    purpose: "inference" | "mcp";
    metadata?: Record<string, string>;
    mcpAccessGroup?: string;
  }): Promise<{ key: string; tokenId: string | null }>;
  deleteKeysByAlias(aliases: string[]): Promise<void>;
};

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringProperty(record: JsonRecord, property: string): string | undefined {
  const value = record[property];
  return typeof value === "string" ? value : undefined;
}

function redact(value: string, secret: string): string {
  return secret ? value.split(secret).join("[REDACTED]") : value;
}

function describeUnknown(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (value instanceof Error) {
    return value.message;
  }
  if (isRecord(value)) {
    return (
      stringProperty(value, "message") ??
      stringProperty(value, "msg") ??
      stringProperty(value, "error") ??
      JSON.stringify(value)
    );
  }
  return String(value);
}

async function readJson(response: Response): Promise<unknown> {
  return response.json().catch(() => null);
}

function errorDetails(
  status: number,
  body: unknown,
): { message: string; type?: string } {
  if (isRecord(body)) {
    const error = body.error;
    if (isRecord(error)) {
      return {
        message: stringProperty(error, "message") ?? `LiteLLM request failed (${status})`,
        type: stringProperty(error, "type"),
      };
    }

    const detail = body.detail;
    if (detail !== undefined) {
      return {
        message: describeUnknown(detail),
        type: isRecord(detail) ? stringProperty(detail, "type") : undefined,
      };
    }
  }

  return { message: `LiteLLM request failed (${status})` };
}

export function createLitellmClient(opts: {
  baseUrl: string;
  adminKey: string;
  fetch?: typeof fetch;
}): LitellmClient {
  const baseUrl = opts.baseUrl.replace(/\/+$/, "");
  const fetchImpl = opts.fetch ?? fetch;

  async function request(
    path: string,
    init: RequestInit,
    toleratedStatuses: readonly number[] = [],
  ): Promise<Response> {
    let response: Response;
    try {
      response = await fetchImpl(`${baseUrl}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${opts.adminKey}`,
          ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
        },
      });
    } catch (error) {
      const message = redact(describeUnknown(error), opts.adminKey);
      throw new LitellmError(0, `LiteLLM unreachable: ${message}`);
    }

    if (!response.ok && !toleratedStatuses.includes(response.status)) {
      const details = errorDetails(response.status, await readJson(response));
      throw new LitellmError(
        response.status,
        redact(details.message, opts.adminKey),
        details.type,
      );
    }

    return response;
  }

  return {
    async findUserByEmail(email) {
      const normalizedEmail = email.trim();
      const expectedEmail = normalizedEmail.toLocaleLowerCase();
      let page = 1;
      let totalPages = 1;

      do {
        const query = new URLSearchParams({
          user_email: normalizedEmail,
          page: String(page),
          page_size: "100",
        });
        const response = await request(`/user/list?${query.toString()}`, {
          method: "GET",
        });
        const body = await readJson(response);

        if (isRecord(body)) {
          const users = Array.isArray(body.users) ? body.users : [];
          for (const user of users) {
            if (!isRecord(user)) {
              continue;
            }
            const userId = stringProperty(user, "user_id");
            const userEmail = stringProperty(user, "user_email");
            if (
              userId &&
              userEmail &&
              userEmail.trim().toLocaleLowerCase() === expectedEmail
            ) {
              return { user_id: userId, user_email: userEmail };
            }
          }

          totalPages =
            typeof body.total_pages === "number" && Number.isFinite(body.total_pages)
              ? Math.max(1, Math.trunc(body.total_pages))
              : 1;
        }

        page += 1;
      } while (page <= totalPages);

      return null;
    },

    async createUser(input) {
      const response = await request("/user/new", {
        method: "POST",
        body: JSON.stringify({
          user_id: input.userId,
          user_email: input.email,
          user_role: "internal_user",
          auto_create_key: false,
          send_invite_email: false,
          metadata: input.metadata ?? {},
        }),
      });
      const body = await readJson(response);
      const userId = isRecord(body) ? stringProperty(body, "user_id") : undefined;
      if (!userId) {
        throw new LitellmError(
          response.status,
          "LiteLLM user creation response did not include user_id",
        );
      }
      return { user_id: userId };
    },

    async generateKey(input) {
      if (input.purpose === "mcp" && !input.mcpAccessGroup) {
        throw new Error("MCP access group is required for MCP keys");
      }
      const response = await request("/key/generate", {
        method: "POST",
        body: JSON.stringify({
          user_id: input.userId,
          key_alias: input.keyAlias,
          metadata: input.metadata ?? {},
          models: input.purpose === "mcp" ? ["no-default-models"] : [],
          max_budget: null,
          key_type: "llm_api",
          ...(input.purpose === "mcp"
            ? {
                object_permission: {
                  mcp_access_groups: [input.mcpAccessGroup!],
                },
              }
            : {}),
        }),
      });
      const body = await readJson(response);
      const key = isRecord(body) ? stringProperty(body, "key") : undefined;
      if (!key) {
        throw new LitellmError(
          response.status,
          "LiteLLM key generation response did not include key",
        );
      }
      const tokenId = isRecord(body) ? stringProperty(body, "token_id") ?? null : null;
      return { key, tokenId };
    },

    async deleteKeysByAlias(aliases) {
      if (aliases.length === 0) {
        return;
      }

      await request(
        "/key/delete",
        {
          method: "POST",
          body: JSON.stringify({ key_aliases: aliases }),
        },
        [404],
      );
    },
  };
}
