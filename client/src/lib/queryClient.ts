import { QueryClient, QueryFunction } from "@tanstack/react-query";

// Same-origin by default (server serves the client). Override with VITE_API_BASE
// when the frontend and backend are hosted on different origins.
const API_BASE = import.meta.env.VITE_API_BASE ?? "";

// Access-gate token (see server/middleware/auth). Kept in localStorage so the
// prompt is one-time per browser; sent on every API request.
const TOKEN_KEY = "golden-egg-access-token";
export const getAccessToken = () => localStorage.getItem(TOKEN_KEY) ?? "";
export const setAccessToken = (t: string) => localStorage.setItem(TOKEN_KEY, t);

function authHeaders(): Record<string, string> {
  const token = getAccessToken();
  return token ? { "x-access-token": token } : {};
}

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

export async function apiRequest(method: string, url: string, data?: unknown | undefined): Promise<Response> {
  const res = await fetch(`${API_BASE}${url}`, {
    method,
    headers: { ...authHeaders(), ...(data ? { "Content-Type": "application/json" } : {}) },
    body: data ? JSON.stringify(data) : undefined,
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: { on401: UnauthorizedBehavior }) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const res = await fetch(`${API_BASE}${queryKey.join("/")}`, { headers: authHeaders() });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
