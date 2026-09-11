"use client";

import { useAuth } from "@/lib/auth";
import { useQuery, type QueryKey } from "@tanstack/react-query";

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); this.name = "ApiError"; }
}

export async function jsonOrError<T>(response: Response, fallback: string): Promise<T> {
  if (response.ok) return response.json() as Promise<T>;
  const payload = await response.json().catch(() => ({ detail: fallback }));
  throw new ApiError(response.status, String(payload.detail || fallback));
}

export function useAuthenticatedQuery<T>(key: QueryKey, url: string, options?: { enabled?: boolean; staleTime?: number; refetchInterval?: number }) {
  const { fetchWithAuth, user, isLoading } = useAuth();
  return useQuery({
    queryKey: key,
    queryFn: async () => jsonOrError<T>(await fetchWithAuth(url), "The requested data could not be loaded."),
    enabled: !isLoading && Boolean(user) && (options?.enabled ?? true),
    staleTime: options?.staleTime,
    refetchInterval: options?.refetchInterval,
  });
}
