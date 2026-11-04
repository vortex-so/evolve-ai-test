import { QueryClient } from "@tanstack/react-query";

let browserQueryClient: QueryClient | undefined;

function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { staleTime: 5_000 },
    },
  });
}

export function getQueryClient(): QueryClient {
  if (typeof window === "undefined") return makeQueryClient();
  browserQueryClient ??= makeQueryClient();
  return browserQueryClient;
}
