import sharp from "sharp";
import { z } from "zod";
import {
  MAX_BATCH_SIZE,
  MAX_FILE_BYTES,
  MAX_PIXELS
} from "./config";
import type {
  ImageMetadata,
  ManualControls,
  SupportedImageFormat
} from "./types";

const controlValueSchema = z.number().finite().min(0).max(100);

export const manualControlsSchema = z.object({
  strength: controlValueSchema,
  sharpness: controlValueSchema,
  noiseReduction: controlValueSchema,
  brightness: controlValueSchema,
  contrast: controlValueSchema
});

export function validateManualControls(input: unknown): ManualControls {
  return manualControlsSchema.parse(input);
}

const MAX_PROMPT_LENGTH = 1000;

export function validatePrompt(input: unknown): string {
  if (typeof input !== "string") {
    throw new Error("Prompt must not be empty");
  }
  const trimmed = input.trim();
  if (trimmed === "") {
    throw new Error("Prompt must not be empty");
  }
  if (trimmed.length > MAX_PROMPT_LENGTH) {
    throw new Error("Prompt must be 1000 characters or fewer");
  }
  if (/[\x00-\x1f\x7f]/.test(trimmed)) {
    throw new Error("Prompt must not contain control characters");
  }
  return trimmed;
}

const MIME_TO_FORMAT: Record<string, SupportedImageFormat> = {
  "image/jpeg": "jpeg",
  "image/jpg": "jpeg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif"
};

const SUPPORTED_FORMATS = new Set<SupportedImageFormat>([
  "jpeg",
  "png",
  "webp",
  "avif"
]);

export function validateBatchSize(size: number): void {
  if (!Number.isInteger(size) || size < 1) {
    throw new Error("Batch must contain at least one image");
  }

  if (size > MAX_BATCH_SIZE) {
    throw new Error(`Maximum batch size is ${MAX_BATCH_SIZE}`);
  }
}

export async function validateUpload(file: {
  buffer: Buffer;
  mimetype: string;
  size: number;
}): Promise<ImageMetadata> {
  const declaredFormat = MIME_TO_FORMAT[file.mimetype.toLowerCase()];
  if (!declaredFormat) {
    throw new Error("Unsupported image. Accepted formats are JPEG, PNG, WebP, and AVIF.");
  }

  if (
    !Buffer.isBuffer(file.buffer) ||
    !Number.isSafeInteger(file.size) ||
    file.size < 0 ||
    Math.max(file.size, file.buffer.length) > MAX_FILE_BYTES
  ) {
    throw new Error(`File exceeds maximum size of ${MAX_FILE_BYTES} bytes`);
  }

  let metadata: sharp.Metadata;
  try {
    metadata = await sharp(file.buffer, { limitInputPixels: MAX_PIXELS }).metadata();
  } catch (error) {
    if (error instanceof Error && /pixel limit/i.test(error.message)) {
      throw new Error(`Image exceeds maximum pixel count of ${MAX_PIXELS}`);
    }

    throw new Error("Unsupported image. Accepted formats are JPEG, PNG, WebP, and AVIF.");
  }

  const format =
    metadata.format === "heif" && metadata.compression === "av1"
      ? "avif"
      : metadata.format;
  if (
    !format ||
    !SUPPORTED_FORMATS.has(format as SupportedImageFormat) ||
    format !== declaredFormat ||
    !metadata.width ||
    !metadata.height
  ) {
    throw new Error("Unsupported image. Accepted formats are JPEG, PNG, WebP, and AVIF.");
  }

  if (metadata.width * metadata.height > MAX_PIXELS) {
    throw new Error(`Image exceeds maximum pixel count of ${MAX_PIXELS}`);
  }

  return {
    format: format as SupportedImageFormat,
    width: metadata.width,
    height: metadata.height,
    size: file.size,
    channels: metadata.channels,
    hasAlpha: metadata.hasAlpha
  };
}
