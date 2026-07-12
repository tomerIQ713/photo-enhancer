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

async function createOrientedJpeg(): Promise<Buffer> {
  return sharp({
    create: {
      width: 10,
      height: 6,
      channels: 3,
      background: { r: 120, g: 80, b: 40 }
    }
  })
    .withMetadata({ orientation: 6 })
    .jpeg()
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
      content:
        | string
        | Array<
            | { type: "text"; text: string }
            | {
                type: "image_url";
                image_url: { url: string };
              }
          >;
    }>;
    const userContent = messages[1].content as Array<
      | { type: "text"; text: string }
      | { type: "image_url"; image_url: { url: string } }
    >;
    expect(requestBody).toMatchObject({
      response_format: { type: "json_object" }
    });
    expect(userContent).toEqual([
      expect.objectContaining({
        type: "text",
        text: expect.stringContaining("preserve identity")
      }),
      {
        type: "image_url",
        image_url: {
          url: expect.stringContaining("data:image/png;base64,")
        }
      }
    ]);
    expect(JSON.stringify(requestBody)).not.toContain("test-key");
  });

  it("falls back when the OpenRouter response body exceeds the timeout", async () => {
    let bodyController: ReadableStreamDefaultController<Uint8Array> | undefined;
    fetchMock.mockImplementationOnce(
      (_input: RequestInfo | URL, init?: RequestInit) => {
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            bodyController = controller;
          }
        });
        init?.signal?.addEventListener("abort", () => bodyController?.error());
        return Promise.resolve(new Response(body, { status: 200 }));
      }
    );

    const provider = new OpenRouterProvider({
      fetch: fetchMock,
      timeoutMs: 20,
      apiKey: "test-key"
    });
    const result = await Promise.race([
      provider.analyze(await createSamplePng(), "auto", defaultControls),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("response body timeout was ignored")), 200)
      )
    ]);

    expect(result).toEqual({
      scale: 1,
      sharpen: 0.5,
      denoise: 1,
      brightness: 0,
      contrast: 1
    });
  });

  it("preserves the oriented aspect ratio when upscaling JPEG orientation 6", async () => {
    const orientedJpeg = await createOrientedJpeg();
    const output = await pipeline.process(
      orientedJpeg,
      "upscale",
      defaultControls,
      "jpg"
    );
    const metadata = await sharp(output).metadata();

    expect(metadata.format).toBe("jpeg");
    expect(metadata.width).toBe(12);
    expect(metadata.height).toBe(20);
  });

  it("does not mutate the original input buffer", async () => {
    const samplePng = await createSamplePng();
    const original = Buffer.from(samplePng);

    await pipeline.process(samplePng, "upscale", defaultControls, "png");

    expect(samplePng.equals(original)).toBe(true);
  });

  it("clamps unsafe parameters before passing them to Sharp", async () => {
    const output = await new LocalImageProvider().apply(
      await createSamplePng(),
      {
        scale: 99,
        sharpen: -20,
        denoise: 99,
        brightness: 99,
        contrast: -99
      },
      "png"
    );
    const metadata = await sharp(output).metadata();

    expect(metadata.width).toBe(32);
    expect(metadata.height).toBe(24);
  });
});
