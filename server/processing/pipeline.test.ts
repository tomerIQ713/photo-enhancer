import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocalImageProvider } from "./local-image-provider";
import { OpenRouterProvider } from "./openrouter-provider";
import { ProcessingPipeline } from "./pipeline";
import type { ManualControls } from "../types";

const defaultControls: ManualControls = {
  strength: 70,
  sharpness: 60,
  noiseReduction: 30,
  brightness: 50,
  contrast: 50
};

const validParameters = {
  scale: 2,
  sharpen: 1,
  denoise: 0,
  brightness: 1,
  contrast: 1
};

async function createSamplePng(width = 8, height = 6): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 120, g: 80, b: 40 }
    }
  })
    .png()
    .toBuffer();
}

describe("ProcessingPipeline", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let requestBody: Record<string, unknown> | undefined;
  let pipeline: ProcessingPipeline;

  beforeEach(() => {
    process.env.OPENROUTER_API_KEY = "test-key";
    fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify(validParameters) } }]
        }),
        { status: 200 }
      );
    });

    pipeline = new ProcessingPipeline(
      new OpenRouterProvider({ fetch: fetchMock, timeoutMs: 100 }),
      new LocalImageProvider()
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.OPENROUTER_API_KEY;
  });

  it("uses safe local processing when OpenRouter returns valid parameters", async () => {
    const samplePng = await createSamplePng();
    const output = await pipeline.process(
      samplePng,
      "upscale",
      defaultControls,
      "png"
    );
    const metadata = await sharp(output).metadata();

    expect(Buffer.isBuffer(output)).toBe(true);
    expect(metadata.format).toBe("png");
    expect(metadata.width).toBeGreaterThan(8);
    expect(metadata.height).toBeGreaterThan(6);
  });

  it("falls back to preset defaults when OpenRouter returns malformed JSON", async () => {
    fetchMock.mockImplementationOnce(async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "not-json" } }]
        }),
        { status: 200 }
      )
    );

    const output = await pipeline.process(
      await createSamplePng(),
      "auto",
      defaultControls,
      "jpg"
    );

    expect(output).toBeInstanceOf(Buffer);
    expect((await sharp(output).metadata()).format).toBe("jpeg");
  });

  it("falls back to preset defaults on a non-successful OpenRouter response", async () => {
    fetchMock.mockImplementationOnce(async () =>
      new Response("upstream failure", { status: 503 })
    );

    const output = await pipeline.process(
      await createSamplePng(),
      "upscale",
      defaultControls,
      "png"
    );

    expect((await sharp(output).metadata()).width).toBe(16);
  });

  it("falls back to preset defaults when OpenRouter times out", async () => {
    fetchMock.mockImplementationOnce(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("The operation was aborted", "AbortError"))
          );
        })
    );

    const output = await pipeline.process(
      await createSamplePng(),
      "auto",
      defaultControls,
      "png"
    );

    expect(output).toBeInstanceOf(Buffer);
    expect((await sharp(output).metadata()).format).toBe("png");
  });

  it("requests JSON-only faithful enhancement instructions", async () => {
    await pipeline.process(
      await createSamplePng(),
      "auto",
      defaultControls,
      "png"
    );

    const messages = requestBody?.messages as Array<{
      role: string;
      content: string;
    }>;
    expect(requestBody).toMatchObject({
      response_format: { type: "json_object" }
    });
    expect(messages[1].content).toContain("preserve identity");
    expect(messages[1].content).toContain("preserve composition");
    expect(messages[1].content).toContain("data:image/png;base64,");
    expect(JSON.stringify(requestBody)).not.toContain("test-key");
  });

  it("does not mutate the original input buffer", async () => {
    const samplePng = await createSamplePng();
    const original = Buffer.from(samplePng);

    await pipeline.process(samplePng, "upscale", defaultControls, "png");

    expect(samplePng.equals(original)).toBe(true);
  });

  it("clamps unsafe provider parameters before local processing", async () => {
    fetchMock.mockImplementationOnce(async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  scale: 99,
                  sharpen: -20,
                  denoise: 99,
                  brightness: 99,
                  contrast: -99
                })
              }
            }
          ]
        }),
        { status: 200 }
      )
    );

    const output = await pipeline.process(
      await createSamplePng(),
      "auto",
      defaultControls,
      "png"
    );
    const metadata = await sharp(output).metadata();

    expect(metadata.width).toBeLessThanOrEqual(32);
    expect(metadata.height).toBeLessThanOrEqual(24);
  });
});
