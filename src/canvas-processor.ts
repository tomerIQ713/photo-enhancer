import type { EnhancementParameters, OutputFormat } from "./openrouter";

export class CanvasProcessor {
  apply(
    image: HTMLImageElement,
    parameters: EnhancementParameters,
    outputFormat: OutputFormat
  ): Promise<Blob> {
    const scale = clamp(parameters.scale, 1, 4);
    const sharpen = clamp(parameters.sharpen, 0, 2);
    const denoise = Math.round(clamp(parameters.denoise, 0, 3));
    const brightness = clamp(parameters.brightness, -1, 1);
    const contrast = clamp(parameters.contrast, 0.5, 1.5);

    const srcW = image.naturalWidth;
    const srcH = image.naturalHeight;
    const dstW = Math.max(1, Math.round(srcW * scale));
    const dstH = Math.max(1, Math.round(srcH * scale));

    const canvas = document.createElement("canvas");
    canvas.width = dstW;
    canvas.height = dstH;
    const ctx = canvas.getContext("2d")!;

    ctx.filter = this.buildFilter(brightness, contrast, sharpen);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = scale > 1 ? "high" : "medium";

    if (denoise > 0 && srcW * srcH < 4_000_000) {
      const tempCanvas = document.createElement("canvas");
      tempCanvas.width = srcW;
      tempCanvas.height = srcH;
      const tempCtx = tempCanvas.getContext("2d")!;
      tempCtx.drawImage(image, 0, 0);
      const imageData = tempCtx.getImageData(0, 0, srcW, srcH);
      const denoised = this.medianFilter(imageData, denoise);
      tempCtx.putImageData(denoised, 0, 0);
      ctx.drawImage(tempCanvas, 0, 0, dstW, dstH);
    } else {
      ctx.drawImage(image, 0, 0, dstW, dstH);
    }

    const mimeType = outputFormat === "jpg" ? "image/jpeg" : "image/png";
    return new Promise((resolve) => {
      canvas.toBlob((blob) => resolve(blob!), mimeType, 0.9);
    });
  }

  normalize(image: HTMLImageElement, outputFormat: OutputFormat): Promise<Blob> {
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(image, 0, 0);
    const mimeType = outputFormat === "jpg" ? "image/jpeg" : "image/png";
    return new Promise((resolve) => {
      canvas.toBlob((blob) => resolve(blob!), mimeType, 0.9);
    });
  }

  imageToBlob(image: HTMLImageElement, format: OutputFormat): Promise<Blob> {
    return this.normalize(image, format);
  }

  private buildFilter(brightness: number, contrast: number, sharpen: number): string {
    const parts: string[] = [];
    if (brightness !== 0) parts.push(`brightness(${1 + brightness * 0.5})`);
    if (contrast !== 1) parts.push(`contrast(${Math.round(contrast * 100)}%)`);
    if (sharpen > 0) {
      const amount = Math.round(sharpen * 50);
      parts.push(`contrast(${100 + amount}%)`);
    }
    return parts.join(" ") || "none";
  }

  private medianFilter(imageData: ImageData, strength: number): ImageData {
    const { data, width, height } = imageData;
    const output = new Uint8ClampedArray(data.length);
    const radius = Math.min(strength, 3);
    const kernelSize = (radius * 2 + 1) ** 2;

    for (let y = radius; y < height - radius; y++) {
      for (let x = radius; x < width - radius; x++) {
        const r: number[] = [];
        const g: number[] = [];
        const b: number[] = [];
        for (let ky = -radius; ky <= radius; ky++) {
          for (let kx = -radius; kx <= radius; kx++) {
            const idx = ((y + ky) * width + (x + kx)) * 4;
            r.push(data[idx]);
            g.push(data[idx + 1]);
            b.push(data[idx + 2]);
          }
        }
        r.sort((a, b) => a - b);
        g.sort((a, b) => a - b);
        b.sort((a, b) => a - b);
        const mid = Math.floor(kernelSize / 2);
        const idx = (y * width + x) * 4;
        output[idx] = r[mid];
        output[idx + 1] = g[mid];
        output[idx + 2] = b[mid];
        output[idx + 3] = 255;
      }
    }
    return new ImageData(output, width, height);
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}
