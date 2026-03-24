import { loadConfig } from "./config.js";

export class ApiError extends Error {
  constructor(
    public status: number,
    public body: unknown,
  ) {
    const msg =
      typeof body === "object" && body !== null && "error" in body
        ? (body as { error: string }).error
        : `HTTP ${status}`;
    super(msg);
    this.name = "ApiError";
  }
}

async function request(
  method: string,
  path: string,
  body?: unknown,
  query?: Record<string, string>,
): Promise<unknown> {
  const config = loadConfig();
  const url = new URL(path, config.server);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v) url.searchParams.set(k, v);
    }
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (config.token) {
    headers["Authorization"] = `Bearer ${config.token}`;
  }

  const res = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 204) return undefined;

  const json = await res.json();
  if (!res.ok) throw new ApiError(res.status, json);
  return json;
}

export const api = {
  get: (path: string, query?: Record<string, string>) =>
    request("GET", path, undefined, query),
  post: (path: string, body: unknown) => request("POST", path, body),
  patch: (path: string, body: unknown) => request("PATCH", path, body),
  delete: (path: string) => request("DELETE", path),
};
