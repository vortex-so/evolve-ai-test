export class FetchError extends Error {
  status: number;
  code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "FetchError";
    this.status = status;
    this.code = code;
  }
}

type ErrorPayload = {
  error?: string;
  code?: string;
  message?: string;
};

async function readBody(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return (await response.json()) as unknown;
  }

  const text = await response.text();
  return text || null;
}

export async function fetchJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  const body = await readBody(response);

  if (!response.ok) {
    const payload = typeof body === "object" && body !== null ? (body as ErrorPayload) : null;
    throw new FetchError(
      (payload?.message ?? payload?.error ?? response.statusText) || "Request failed",
      response.status,
      payload?.code ?? payload?.error,
    );
  }

  return body as T;
}

export function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return fallback;
}
