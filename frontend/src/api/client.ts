// All requests use relative /api URLs: the production frontend and API share one
// origin, so testers on the same network never call their own localhost.

export class ApiError extends Error {
  status: number;
  code: string;
  detail: unknown;
  constructor(status: number, message: string, code = "", detail: unknown = null) {
    super(message);
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

let csrfToken = "";

export function setCsrf(token: string) {
  csrfToken = token;
}

function readCsrfCookie(): string {
  const m = document.cookie.match(/(?:^|; )respace_csrf=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : "";
}

function messageFrom(detail: unknown, fallback: string): { message: string; code: string } {
  if (typeof detail === "string") return { message: detail, code: "" };
  if (Array.isArray(detail)) {
    const first = detail[0] as { msg?: string; loc?: unknown[] } | undefined;
    return { message: first?.msg ? `${first.msg}` : fallback, code: "validation" };
  }
  if (detail && typeof detail === "object") {
    const d = detail as { message?: string; code?: string };
    return { message: d.message ?? fallback, code: d.code ?? "" };
  }
  return { message: fallback, code: "" };
}

export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const method = (init.method ?? "GET").toUpperCase();
  let body = init.body;
  if (init.json !== undefined) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(init.json);
  }
  if (method !== "GET" && method !== "HEAD") {
    headers.set("X-CSRF-Token", csrfToken || readCsrfCookie());
  }
  let res: Response;
  try {
    res = await fetch(path, { ...init, method, headers, body, credentials: "same-origin" });
  } catch (err) {
    if ((err as Error).name === "AbortError") throw new ApiError(499, "Cancelled.", "cancelled");
    throw new ApiError(0, "Cannot reach the ReSpace server. Check that it is running.", "network");
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const detail = (data as { detail?: unknown } | null)?.detail ?? data;
    const { message, code } = messageFrom(detail, `Request failed (${res.status}).`);
    throw new ApiError(res.status, message, code, detail);
  }
  return data as T;
}

export async function apiBlob(path: string): Promise<Blob> {
  const res = await fetch(path, { credentials: "same-origin" });
  if (!res.ok) throw new ApiError(res.status, `Download failed (${res.status}).`);
  return res.blob();
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
