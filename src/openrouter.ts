export interface ManualControls {
  strength: number;
  sharpness: number;
  noiseReduction: number;
  brightness: number;
  contrast: number;
}

export interface EnhancementParameters {
  scale: number;
  sharpen: number;
  denoise: number;
  brightness: number;
  contrast: number;
}

export type Preset = "auto" | "upscale";
export type UpscaleMode = "ai" | "classic";
export type OutputFormat = "jpg" | "png";

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

export function presetDefaults(preset: Preset): EnhancementParameters {
  if (preset === "upscale") {
    return { scale: 2, sharpen: 0.8, denoise: 1, brightness: 0, contrast: 1 };
  }
  return { scale: 1, sharpen: 0.5, denoise: 1, brightness: 0, contrast: 1 };
}

export function mergeControls(
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
    scale: clamp(preset === "upscale" ? base.scale + (strength - 50) / 100 : base.scale, 1, 4),
    sharpen: clamp(Math.round((base.sharpen + (strength - 50) / 100 + (sharpness - 50) / 50) * 1000) / 1000, 0, 2),
    denoise: clamp(base.denoise + (noiseReduction - 50) / 25, 0, 3),
    brightness: clamp(base.brightness + (brightness - 50) / 50, -1, 1),
    contrast: clamp(base.contrast + (contrast - 50) / 100, 0.5, 1.5)
  };
}

export class OpenRouterClient {
  private readonly model: string;
  private readonly imageModel: string;
  private readonly timeoutMs: number;

  constructor(options: {
    model?: string;
    imageModel?: string;
    timeoutMs?: number;
  } = {}) {
    this.model = options.model ?? "google/gemini-2.5-flash";
    this.imageModel = options.imageModel ?? "google/gemini-2.5-flash-image";
    this.timeoutMs = options.timeoutMs ?? 60000;
  }

  private toBase64(canvas: HTMLCanvasElement): string {
    return canvas.toDataURL("image/png").split(",")[1];
  }

  private toCanvas(image: HTMLImageElement): HTMLCanvasElement {
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(image, 0, 0);
    return canvas;
  }

  async analyze(
    image: HTMLImageElement,
    preset: Preset,
    controls: ManualControls,
    apiKey: string
  ): Promise<EnhancementParameters> {
    const fallback = presetDefaults(preset);
    if (!apiKey) return fallback;

    const dataUrl = this.toCanvas(image).toDataURL("image/png");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        let response: Response;
        try {
          response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              model: this.model,
              response_format: { type: "json_object" },
              messages: [
                { role: "system", content: "You are a faithful photo enhancement analyzer. Return only a JSON object with numeric scale, sharpen, denoise, brightness, and contrast fields." },
                {
                  role: "user",
                  content: [
                    { type: "text", text: `Analyze this photo for the ${preset} preset using manual controls ${JSON.stringify(controls)}. preserve identity and preserve composition; do not generate, replace, or invent image content. Return JSON only with scale in [1, 4], sharpen in [0, 2], denoise in [0, 3], brightness in [-1, 1], and contrast in [0.5, 1.5].` },
                    { type: "image_url", image_url: { url: dataUrl } }
                  ]
                }
              ]
            }),
            signal: controller.signal
          });
        } catch {
          if (controller.signal.aborted || attempt === 2) return fallback;
          continue;
        }

        if (!response.ok) {
          if (![429, 500, 502, 503, 504].includes(response.status) || attempt === 2) return fallback;
          continue;
        }

        try {
          const body = await response.json() as { choices: Array<{ message: { content: string } }> };
          const params = JSON.parse(body.choices[0].message.content);
          const scale = clamp(Number(params.scale), 1, 4);
          const sharpen = clamp(Number(params.sharpen), 0, 2);
          const denoise = clamp(Number(params.denoise), 0, 3);
          const brightness = clamp(Number(params.brightness), -1, 1);
          const contrast = clamp(Number(params.contrast), 0.5, 1.5);
          if (isNaN(scale) || isNaN(sharpen) || isNaN(denoise) || isNaN(brightness) || isNaN(contrast)) return fallback;
          return { scale, sharpen, denoise, brightness, contrast };
        } catch {
          return fallback;
        }
      }
      return fallback;
    } finally {
      clearTimeout(timeout);
    }
  }

  async enhanceImage(
    image: HTMLImageElement,
    controls: ManualControls,
    apiKey: string
  ): Promise<HTMLImageElement | null> {
    if (!apiKey) return null;

    const dataUrl = this.toCanvas(image).toDataURL("image/png");
    const strengthPercent = Math.round(clamp(controls.strength, 0, 100));
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        let response: Response;
        try {
          response = await fetch("https://openrouter.ai/api/v1/images", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              model: this.imageModel,
              prompt: `Upscale this image to higher resolution. Enhancement strength: ${strengthPercent}%. Preserve identity, composition, colors, and all original content. Do not add, remove, or invent elements. Do not change the aspect ratio. Maintain faithful detail reconstruction.`,
              input_references: [{ type: "image_url", image_url: { url: dataUrl } }],
              output_format: "png"
            }),
            signal: controller.signal
          });
        } catch {
          if (controller.signal.aborted || attempt === 2) return null;
          continue;
        }

        if (!response.ok) {
          if (![429, 500, 502, 503, 504].includes(response.status) || attempt === 2) return null;
          continue;
        }

        try {
          const body = await response.json() as { data: Array<{ b64_json: string }> };
          if (!body.data?.[0]?.b64_json) return null;
          return await this.base64ToImage(body.data[0].b64_json);
        } catch {
          return null;
        }
      }
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  private base64ToImage(b64: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Failed to decode image"));
      img.src = `data:image/png;base64,${b64}`;
    });
  }
}
