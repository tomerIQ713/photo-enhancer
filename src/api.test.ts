import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, getJob } from "./api";

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
});
