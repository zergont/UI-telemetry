const API_BASE = "";

let _token = "";

export function setToken(token: string) {
  _token = token;
}

export function getToken(): string {
  return _token;
}

export class ApiError extends Error {
  status: number;
  body: string;

  constructor(status: number, body: string) {
    super(`API error ${status}: ${body}`);
    this.status = status;
    this.body = body;
  }
}

export async function apiFetch<T>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...((options?.headers as Record<string, string>) ?? {}),
  };

  // Bearer token добавляем только если реально задан
  if (_token) {
    headers["Authorization"] = `Bearer ${_token}`;
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    credentials: "include",
    headers,
  });
  if (!res.ok) {
    throw new ApiError(res.status, await res.text());
  }
  return res.json();
}
