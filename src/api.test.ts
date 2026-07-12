import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, downloadResult, getJob } from "./api";

describe("client API errors", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("preserves the HTTP status on JSON API errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "Job expired" }), {
        status: 410,
        headers: { "content-type": "application/json" }
      })
    ));

    await expect(getJob("expired-job")).rejects.toEqual(
      expect.objectContaining({ name: "ApiError", status: 410, message: "Job expired" })
    );
    await expect(getJob("expired-job")).rejects.toBeInstanceOf(ApiError);
  });

  it("preserves a 410 when a result download is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "Result expired" }), {
        status: 410,
        headers: { "content-type": "application/json" }
      })
    ));

    await expect(downloadResult("job-1", "task-1", "png")).rejects.toEqual(
      expect.objectContaining({ name: "ApiError", status: 410, message: "Result expired" })
    );
  });
});
