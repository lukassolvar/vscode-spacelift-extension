import { describe, expect, it, vi } from "vitest";
import { fetchLogs } from "./logs";

describe("fetchLogs", () => {
  it("follows nextToken until the last page and keeps message order", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({ stack: { run: { logs: { messages: [{ message: "a" }, { message: "b" }], hasMore: true, nextToken: "t1", finished: false } } } })
      .mockResolvedValueOnce({ stack: { run: { logs: { messages: [{ message: "c" }], hasMore: false, nextToken: null, finished: true } } } });

    const result = await fetchLogs({ request }, "s", "r", "PLANNING");

    expect(result).toEqual({ text: "a\nb\nc", finished: true });
    expect(request.mock.calls[1][1].token).toBe("t1");
  });

  it("requests the specific state version when given one", async () => {
    const request = vi.fn().mockResolvedValue({ stack: { run: { logs: { messages: [], hasMore: false, nextToken: null, finished: true } } } });

    await fetchLogs({ request }, "s", "r", "PLANNING", 4);

    expect(request.mock.calls[0][1].stateVersion).toBe(4);
  });

  it("reports missing logs instead of throwing", async () => {
    const request = vi.fn().mockResolvedValue({ stack: { run: { logs: null } } });

    const result = await fetchLogs({ request }, "s", "r", "APPLYING");

    expect(result.text).toMatch(/no logs/i);
    expect(result.finished).toBe(true);
  });
});
