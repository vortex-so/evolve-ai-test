/**
 * Postmark send helper backed by server-side templates. Templates are managed
 * out-of-band via the Postmark Templates API (see scripts/postmark-templates.sh)
 * and referenced here by TemplateAlias.
 *
 * Aliases:
 *   vortex-verify-email     — { name, url, product_name, product_url }
 *   vortex-reset-password   — { name, url, product_name, product_url }
 *   vortex-twofa-otp        — { name, otp, product_name, product_url }
 */

export type PostmarkConfig = {
  token: string;
  from: string;
  productName: string;
  productUrl: string;
};

export type TemplateAlias =
  | "vortex-verify-email"
  | "vortex-reset-password"
  | "vortex-twofa-otp";

type SendTemplateInput = {
  to: string;
  alias: TemplateAlias;
  model: Record<string, string>;
  tag?: string;
};

type PostmarkResponse = { MessageID: string; ErrorCode: number; Message: string };

export class PostmarkError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
    this.name = "PostmarkError";
  }
}

export async function sendTemplateEmail(
  cfg: PostmarkConfig,
  input: SendTemplateInput,
): Promise<PostmarkResponse> {
  const res = await fetch("https://api.postmarkapp.com/email/withTemplate", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Postmark-Server-Token": cfg.token,
    },
    body: JSON.stringify({
      From: cfg.from,
      To: input.to,
      TemplateAlias: input.alias,
      TemplateModel: {
        product_name: cfg.productName,
        product_url: cfg.productUrl,
        ...input.model,
      },
      MessageStream: "outbound",
      ...(input.tag ? { Tag: input.tag } : {}),
    }),
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new PostmarkError(
      typeof body.Message === "string" ? body.Message : `Postmark ${res.status}`,
      res.status,
      body,
    );
  }
  return body as unknown as PostmarkResponse;
}

export async function sendTemplateSafe(
  cfg: PostmarkConfig,
  input: SendTemplateInput,
): Promise<void> {
  try {
    const r = await sendTemplateEmail(cfg, input);
    console.log("[postmark]", { alias: input.alias, to: input.to, id: r.MessageID });
  } catch (e) {
    console.error(
      "[postmark]",
      e instanceof PostmarkError
        ? { status: e.status, body: e.body, msg: e.message, alias: input.alias }
        : { alias: input.alias, err: String(e) },
    );
  }
}
