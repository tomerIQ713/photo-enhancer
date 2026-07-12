import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocalImageProvider } from "./local-image-provider";
import { OpenRouterProvider, mergeManualControls, presetDefaults } from "./openrouter-provider";
import { ProcessingPipeline } from "./pipeline";
import type { ManualControls } from "../types";

const defaultControls: ManualControls = {
  strength: 50,
  sharpness: 50,
  noiseReduction: 50,
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

async function createLargerPng(): Promise<Buffer> {
  return sharp({
    create: {
      width: 16,
      height: 12,
      channels: 3,
      background: { r: 60, g: 120, b: 200 }
    }
  })
    .png()
    .toBuffer();
}

describe("ProcessingPipeline", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let requestBody: Record<string, unknown> | undefined;
  let requestUrl: string | undefined;
  let pipeline: ProcessingPipeline;

  beforeEach(() => {
    process.env.OPENROUTER_API_KEY = "test-key";
    requestUrl = undefined;
    fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input);
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

  it("retries retryable OpenRouter failures and succeeds within the request deadline", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response("busy", { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify(validParameters) } }]
      }), { status: 200 }));
    const provider = new OpenRouterProvider({
      fetch: fetchMock,
      timeoutMs: 200,
      retryDelayMs: 1,
      apiKey: "test-key"
    });

    await expect(provider.analyze(await createSamplePng(), "auto", defaultControls))
      .resolves.toEqual(validParameters);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry a successful response with malformed JSON", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      choices: [{ message: { content: "not-json" } }]
    }), { status: 200 }));
    const provider = new OpenRouterProvider({
      fetch: fetchMock,
      timeoutMs: 200,
      retryDelayMs: 1,
      apiKey: "test-key"
    });

    await expect(provider.analyze(await createSamplePng(), "auto", defaultControls))
      .resolves.toEqual(presetDefaults("auto"));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("applies validated manual controls to deterministic fallback output", async () => {
    const sample = await createSamplePng();
    const provider = new OpenRouterProvider({ fetch: fetchMock, apiKey: "" });
    const fallbackPipeline = new ProcessingPipeline(provider, new LocalImageProvider());
    const subtle = await fallbackPipeline.process(sample, "auto", {
      strength: 0,
      sharpness: 0,
      noiseReduction: 0,
      brightness: 0,
      contrast: 0
    }, "png");
    const strong = await fallbackPipeline.process(sample, "auto", {
      strength: 100,
      sharpness: 100,
      noiseReduction: 100,
      brightness: 100,
      contrast: 100
    }, "png");

    expect(strong.equals(subtle)).toBe(false);
    expect(mergeManualControls(presetDefaults("upscale"), {
      strength: 999,
      sharpness: -10,
      noiseReduction: 50,
      brightness: 50,
      contrast: 50
    }, "upscale")).toMatchObject({
      scale: 2.5,
      sharpen: 0.3,
      denoise: 1
    });
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

  it("uses AI image-to-image when upscaleMode is ai and returns a valid buffer", async () => {
    const aiOutput = await createLargerPng();
    fetchMock.mockImplementationOnce(async (input: RequestInfo | URL) => {
      requestUrl = String(input);
      return new Response(
        JSON.stringify({
          data: [{ b64_json: aiOutput.toString("base64"), media_type: "image/png" }]
        }),
        { status: 200 }
      );
    });

    const output = await pipeline.process(
      await createSamplePng(),
      "upscale",
      defaultControls,
      "png",
      "ai"
    );

    expect(requestUrl).toBe("https://openrouter.ai/api/v1/images");
    expect(Buffer.isBuffer(output)).toBe(true);
    const metadata = await sharp(output).metadata();
    expect(metadata.format).toBe("png");
    expect(metadata.width).toBe(16);
  });

  it("sends input_references with the image and faithful instructions in AI mode", async () => {
    const aiOutput = await createLargerPng();
    fetchMock.mockImplementationOnce(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input);
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(
        JSON.stringify({
          data: [{ b64_json: aiOutput.toString("base64"), media_type: "image/png" }]
        }),
        { status: 200 }
      );
    });

    await pipeline.process(
      await createSamplePng(),
      "upscale",
      defaultControls,
      "png",
      "ai"
    );

    expect(requestBody).toMatchObject({
      model: "google/gemini-2.5-flash-image",
      input_references: [
        {
          type: "image_url",
          image_url: { url: expect.stringContaining("data:image/png;base64,") }
        }
      ],
      output_format: "png"
    });
    expect(requestBody?.prompt).toContain("Preserve identity");
    expect(JSON.stringify(requestBody)).not.toContain("test-key");
  });

  it("falls back to analyze+Sharp when AI upscale returns no image", async () => {
    fetchMock.mockResolvedValueOnce(new Response(
      JSON.stringify({ data: [] }),
      { status: 200 }
    ));

    const output = await pipeline.process(
      await createSamplePng(),
      "upscale",
      defaultControls,
      "png",
      "ai"
    );

    expect(Buffer.isBuffer(output)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(requestUrl).toBe("https://openrouter.ai/api/v1/chat/completions");
  });

  it("falls back to analyze+Sharp when AI upscale returns non-2xx", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response("error", { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify(validParameters) } }]
      }), { status: 200 }));

    const output = await pipeline.process(
      await createSamplePng(),
      "upscale",
      defaultControls,
      "png",
      "ai"
    );

    expect(Buffer.isBuffer(output)).toBe(true);
  });

  it("does not call the Image API when upscaleMode is classic", async () => {
    await pipeline.process(
      await createSamplePng(),
      "upscale",
      defaultControls,
      "png",
      "classic"
    );

    expect(requestUrl).toBe("https://openrouter.ai/api/v1/chat/completions");
  });

  it("does not call the Image API for auto preset even with ai mode", async () => {
    await pipeline.process(
      await createSamplePng(),
      "auto",
      defaultControls,
      "png",
      "ai"
    );

    expect(requestUrl).toBe("https://openrouter.ai/api/v1/chat/completions");
  });
});
