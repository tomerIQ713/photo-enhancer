import sharp from "sharp";
import type { EnhancementParameters, OutputFormat } from "../types";

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

export class LocalImageProvider {
  async apply(
    input: Buffer,
    parameters: EnhancementParameters,
    outputFormat: OutputFormat
  ): Promise<Buffer> {
    const scale = clamp(parameters.scale, 1, 4);
    const sharpen = clamp(parameters.sharpen, 0, 2);
    const denoise = Math.round(clamp(parameters.denoise, 0, 3));
    const brightness = clamp(parameters.brightness, -1, 1);
    const contrast = clamp(parameters.contrast, 0.5, 1.5);
    const source = Buffer.from(input);
    const normalized = await sharp(source).rotate().toBuffer();
    const metadata = await sharp(normalized).metadata();
    const image = sharp(normalized);

    if (brightness !== 0 || contrast !== 1) {
      image.linear(contrast, brightness * 32);
    }

    if (denoise > 0) {
      const smallestDimension = Math.min(metadata.width ?? 1, metadata.height ?? 1);
      const largestSafeWindow = smallestDimension % 2 === 0
        ? smallestDimension - 1
        : smallestDimension;
      const medianSize = Math.min(denoise * 2 + 1, largestSafeWindow);
      if (medianSize >= 3) image.median(medianSize);
    }

    if (sharpen > 0) {
      image.sharpen(sharpen);
    }

    if (scale > 1) {
      if (metadata.width && metadata.height) {
        image.resize({
          width: Math.max(1, Math.round(metadata.width * scale)),
          height: Math.max(1, Math.round(metadata.height * scale)),
          kernel: sharp.kernel.lanczos3
        });
      }
    }

    return outputFormat === "jpg"
      ? image.jpeg({ quality: 90 }).toBuffer()
      : image.png().toBuffer();
  }

  async normalize(input: Buffer, outputFormat: OutputFormat): Promise<Buffer> {
    const source = Buffer.from(input);
    const image = sharp(source).rotate();
    return outputFormat === "jpg"
      ? image.jpeg({ quality: 90 }).toBuffer()
      : image.png().toBuffer();
  }
}
