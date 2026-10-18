import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiError, setCsrf } from "./client";

describe("api client", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("uses relative URLs, same-origin credentials and a CSRF header on writes", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    setCsrf("token-123");
    await api("/api/projects", { method: "POST", json: { name: "x" } });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/projects");
    expect(init.credentials).toBe("same-origin");
    expect(new Headers(init.headers).get("X-CSRF-Token")).toBe("token-123");
    await api("/api/projects");
    const [, getInit] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect(new Headers(getInit.headers).has("X-CSRF-Token")).toBe(false);
  });

  it("turns structured errors into readable ApiError values", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ detail: { code: "ai_quota", message: "Quota reached" } }), { status: 429 })));
    const err = (await api("/api/x").catch((e) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(429);
    expect(err.code).toBe("ai_quota");
    expect(err.message).toBe("Quota reached");
  });

  it("reports an unreachable server clearly", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    const err = (await api("/api/x").catch((e) => e)) as ApiError;
    expect(err.code).toBe("network");
  });
});
