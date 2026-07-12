import sharp from "sharp";
import { z } from "zod";
import { OPENROUTER_MODEL, OPENROUTER_TIMEOUT_MS } from "../config";
import type {
  EnhancementParameters,
  ManualControls,
  Preset
} from "../types";

const parameterSchema = z.object({
  scale: z.number().finite().min(1).max(4),
  sharpen: z.number().finite().min(0).max(2),
  denoise: z.number().finite().min(0).max(3),
  brightness: z.number().finite().min(-1).max(1),
  contrast: z.number().finite().min(0.5).max(1.5)
});

const responseSchema = z.object({
  choices: z
    .array(z.object({ message: z.object({ content: z.string() }) }))
    .min(1)
});

export interface OpenRouterProviderOptions {
  fetch?: typeof fetch;
  timeoutMs?: number;
  apiKey?: string;
  model?: string;
}

export function presetDefaults(preset: Preset): EnhancementParameters {
  if (preset === "upscale") {
    return {
      scale: 2,
      sharpen: 0.8,
      denoise: 1,
      brightness: 0,
      contrast: 1
    };
  }

  return {
    scale: 1,
    sharpen: 0.5,
    denoise: 1,
    brightness: 0,
    contrast: 1
  };
}

export class OpenRouterProvider {
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly apiKey: string;
  private readonly model: string;

  constructor(options: OpenRouterProviderOptions = {}) {
    this.fetchImpl = options.fetch ?? fetch;
    this.timeoutMs = options.timeoutMs ?? OPENROUTER_TIMEOUT_MS;
    this.apiKey = options.apiKey ?? process.env.OPENROUTER_API_KEY ?? "";
    this.model = options.model ?? OPENROUTER_MODEL;
  }

  async analyze(
    input: Buffer,
    preset: Preset,
    controls: ManualControls
  ): Promise<EnhancementParameters> {
    const fallback = presetDefaults(preset);
    if (process.env.E2E_FAKE_PROCESSING === "true") {
      return fallback;
    }

    if (!this.apiKey) {
      return fallback;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const image = await sharp(input).png().toBuffer();
      const dataUrl = `data:image/png;base64,${image.toString("base64")}`;
      const response = await this.fetchImpl(
        "https://openrouter.ai/api/v1/chat/completions",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            model: this.model,
            response_format: { type: "json_object" },
            messages: [
              {
                role: "system",
                content:
                  "You are a faithful photo enhancement analyzer. Return only a JSON object with numeric scale, sharpen, denoise, brightness, and contrast fields."
              },
              {
                role: "user",
                content: [
                  { type: "text", text: this.instruction(preset, controls) },
                  { type: "image_url", image_url: { url: dataUrl } }
                ]
              }
            ]
          }),
          signal: controller.signal
        }
      );

      if (!response.ok) {
        return fallback;
      }

      const parsedResponse = responseSchema.safeParse(await response.json());
      if (!parsedResponse.success) {
        return fallback;
      }

      const parsedParameters = parameterSchema.safeParse(
        JSON.parse(parsedResponse.data.choices[0].message.content)
      );
      return parsedParameters.success ? parsedParameters.data : fallback;
    } catch {
      return fallback;
    } finally {
      clearTimeout(timeout);
    }
  }

  private instruction(preset: Preset, controls: ManualControls): string {
    return [
      `Analyze this photo for the ${preset} preset using the manual controls ${JSON.stringify(controls)}.`,
      "preserve identity and preserve composition; do not generate, replace, or invent image content.",
      "Return JSON only with scale in [1, 4], sharpen in [0, 2], denoise in [0, 3], brightness in [-1, 1], and contrast in [0.5, 1.5]."
    ].join(" ");
  }
}
