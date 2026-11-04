export async function readErrorResponse(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as { error?: string; message?: string };
    return payload.message ?? payload.error ?? `Request failed with status ${response.status}`;
  } catch {
    return `Request failed with status ${response.status}`;
  }
}

export async function fetchJsonOrThrow<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);

  if (!response.ok) {
    throw new Error(await readErrorResponse(response));
  }

  return (await response.json()) as T;
}

export async function mutateOrThrow(input: RequestInfo | URL, init?: RequestInit): Promise<void> {
  const response = await fetch(input, init);

  if (!response.ok) {
    throw new Error(await readErrorResponse(response));
  }
}
