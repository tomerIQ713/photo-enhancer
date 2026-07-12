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
  retryDelayMs?: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

export function mergeManualControls(
  base: EnhancementParameters,
  controls: ManualControls,
  preset: Preset
): EnhancementParameters {
  const strength = clamp(controls.strength, 0, 100);
  const sharpness = clamp(controls.sharpness, 0, 100);
  const noiseReduction = clamp(controls.noiseReduction, 0, 100);
  const brightness = clamp(controls.brightness, 0, 100);
  const contrast = clamp(controls.contrast, 0, 100);
  return {
    scale: clamp(
      preset === "upscale" ? base.scale + (strength - 50) / 100 : base.scale,
      1,
      4
    ),
    sharpen: clamp(
      Math.round((base.sharpen + (strength - 50) / 100 + (sharpness - 50) / 50) * 1000) / 1000,
      0,
      2
    ),
    denoise: clamp(base.denoise + (noiseReduction - 50) / 25, 0, 3),
    brightness: clamp(base.brightness + (brightness - 50) / 50, -1, 1),
    contrast: clamp(base.contrast + (contrast - 50) / 100, 0.5, 1.5)
  };
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
  private readonly retryDelayMs: number;

  constructor(options: OpenRouterProviderOptions = {}) {
    this.fetchImpl = options.fetch ?? fetch;
    this.timeoutMs = options.timeoutMs ?? OPENROUTER_TIMEOUT_MS;
    this.apiKey = options.apiKey ?? process.env.OPENROUTER_API_KEY ?? "";
    this.model = options.model ?? OPENROUTER_MODEL;
    this.retryDelayMs = options.retryDelayMs ?? 200;
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
      for (let attempt = 0; attempt < 3; attempt += 1) {
        let response: Response;
        try {
          response = await this.fetchImpl(
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
        } catch (error) {
          if (controller.signal.aborted || attempt === 2) return fallback;
          await this.waitBeforeRetry(attempt, controller);
          continue;
        }

        if (!response.ok) {
          if (![429, 500, 502, 503, 504].includes(response.status) || attempt === 2) {
            return fallback;
          }
          await this.waitBeforeRetry(attempt, controller);
          continue;
        }

        const parsedResponse = responseSchema.safeParse(await response.json());
        if (!parsedResponse.success) return fallback;

        try {
          const parsedParameters = parameterSchema.safeParse(
            JSON.parse(parsedResponse.data.choices[0].message.content)
          );
          return parsedParameters.success ? parsedParameters.data : fallback;
        } catch {
          return fallback;
        }
      }
      return fallback;
    } catch {
      return fallback;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async waitBeforeRetry(attempt: number, controller: AbortController): Promise<void> {
    const delay = Math.min(this.retryDelayMs * 2 ** attempt, Math.max(0, this.timeoutMs / 2));
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, delay);
      controller.signal.addEventListener("abort", () => {
        clearTimeout(timer);
        resolve();
      }, { once: true });
    });
  }

  private instruction(preset: Preset, controls: ManualControls): string {
    return [
      `Analyze this photo for the ${preset} preset using the manual controls ${JSON.stringify(controls)}.`,
      "preserve identity and preserve composition; do not generate, replace, or invent image content.",
      "Return JSON only with scale in [1, 4], sharpen in [0, 2], denoise in [0, 3], brightness in [-1, 1], and contrast in [0.5, 1.5]."
    ].join(" ");
  }
}
