import { describe, expect, it, vi } from "vitest";
import { SpaceliftClient } from "./client";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status });

describe("SpaceliftClient", () => {
  it("retries once with a refreshed token when the token is rejected", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(json(401, {}))
      .mockResolvedValueOnce(json(200, { data: { ok: true } }));
    const getToken = vi.fn(async (refresh: boolean) => (refresh ? "new" : "old"));
    const client = new SpaceliftClient({ endpoint: () => "https://x.app.spacelift.io", getToken, fetch });

    await expect(client.request("query { ok }")).resolves.toEqual({ ok: true });

    expect(getToken.mock.calls.map((c) => c[0])).toEqual([false, true]);
    expect(fetch.mock.calls[1][1].headers.Authorization).toBe("Bearer new");
  });

  it("refuses to send credentials to a non-https endpoint", async () => {
    const fetch = vi.fn();
    const getToken = vi.fn(async () => "t");
    const client = new SpaceliftClient({ endpoint: () => "http://x.app.spacelift.io", getToken, fetch });

    await expect(client.request("query { x }")).rejects.toThrow(/https/);

    expect(getToken).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("throws GraphQL error messages instead of returning partial data", async () => {
    const fetch = vi.fn().mockResolvedValue(json(200, { errors: [{ message: "nope" }, { message: "bad" }] }));
    const client = new SpaceliftClient({ endpoint: () => "https://x", getToken: async () => "t", fetch });

    await expect(client.request("query { x }")).rejects.toThrow("nope; bad");
  });
});
