import type { APIRequestContext } from "@playwright/test";
import { POSTMARK_SERVER_TOKEN } from "./constants";

type PostmarkMessage = {
  MessageID: string;
  Recipients: string[];
  Subject: string;
  Tag: string | null;
  Status: string;
  ReceivedAt: string;
};

export function postmarkAvailable(): boolean {
  return POSTMARK_SERVER_TOKEN.length > 0;
}

export async function findRecentMessage(
  request: APIRequestContext,
  filter: { toContains: string; tag?: string; sinceMs?: number },
): Promise<PostmarkMessage | null> {
  if (!postmarkAvailable()) return null;
  const url = new URL("https://api.postmarkapp.com/messages/outbound");
  url.searchParams.set("count", "20");
  url.searchParams.set("offset", "0");
  if (filter.tag) url.searchParams.set("tag", filter.tag);

  const res = await request.get(url.toString(), {
    headers: {
      Accept: "application/json",
      "X-Postmark-Server-Token": POSTMARK_SERVER_TOKEN,
    },
  });
  if (!res.ok()) return null;
  const body = (await res.json()) as { Messages: PostmarkMessage[] };
  const cutoff = filter.sinceMs ?? Date.now() - 10 * 60 * 1000;
  return (
    body.Messages.find((m) => {
      const receivedAt = new Date(m.ReceivedAt).getTime();
      return (
        receivedAt >= cutoff &&
        m.Recipients.some((r) => r.toLowerCase().includes(filter.toContains.toLowerCase()))
      );
    }) ?? null
  );
}

export async function waitForRecentMessage(
  request: APIRequestContext,
  filter: { toContains: string; tag?: string; sinceMs?: number },
  timeoutMs = 30_000,
): Promise<PostmarkMessage> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const msg = await findRecentMessage(request, filter);
    if (msg) return msg;
    await new Promise((r) => setTimeout(r, 2_000));
  }
  throw new Error(
    `Postmark message not found within ${timeoutMs}ms for filter ${JSON.stringify(filter)}`,
  );
}
