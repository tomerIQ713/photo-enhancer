import { describe, expect, it } from "vitest";
import sharp from "sharp";
import {
  manualControlsSchema,
  validateManualControls,
  validateBatchSize,
  validateUpload
} from "./validation";
import { MAX_FILE_BYTES, MAX_PIXELS } from "./config";

const validPngFile = {
  buffer: Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64"
  ),
  mimetype: "image/png",
  size: 68
};

const validControls = {
  strength: 0,
  sharpness: 100,
  noiseReduction: 50,
  brightness: 25,
  contrast: 75
};

const controlNames = [
  "strength",
  "sharpness",
  "noiseReduction",
  "brightness",
  "contrast"
] as const;

describe("manual controls validation", () => {
  it("accepts all finite control values at the documented bounds", () => {
    expect(manualControlsSchema.safeParse(validControls).success).toBe(true);
    expect(validateManualControls(validControls)).toEqual(validControls);
  });

  it.each(controlNames)("rejects out-of-range or non-finite %s", (name) => {
    expect(() =>
      validateManualControls({ ...validControls, [name]: -1 })
    ).toThrow();
    expect(() =>
      validateManualControls({ ...validControls, [name]: 101 })
    ).toThrow();
    expect(() =>
      validateManualControls({ ...validControls, [name]: Number.NaN })
    ).toThrow();
    expect(() =>
      validateManualControls({ ...validControls, [name]: Number.POSITIVE_INFINITY })
    ).toThrow();
  });
});

describe("upload validation", () => {
  it("accepts a PNG within the configured limits", async () => {
    await expect(validateUpload(validPngFile)).resolves.toMatchObject({
      format: "png"
    });
  });

  it("rejects a file whose content is not an image", async () => {
    await expect(
      validateUpload({ ...validPngFile, buffer: Buffer.from("not image") })
    ).rejects.toThrow("Unsupported image");
  });

  it("rejects an unsupported declared MIME type", async () => {
    await expect(
      validateUpload({ ...validPngFile, mimetype: "image/gif" })
    ).rejects.toThrow("Accepted formats are JPEG, PNG, WebP, and AVIF");
  });

  it("rejects a file over the configured byte limit", async () => {
    await expect(
      validateUpload({ ...validPngFile, size: MAX_FILE_BYTES + 1 })
    ).rejects.toThrow(`maximum size of ${MAX_FILE_BYTES} bytes`);
  });

  it("rejects a MIME and content mismatch", async () => {
    await expect(
      validateUpload({ ...validPngFile, mimetype: "image/jpeg" })
    ).rejects.toThrow("Unsupported image");
  });

  it("does not mutate the accepted upload buffer", async () => {
    const buffer = Buffer.from(validPngFile.buffer);
    const original = Buffer.from(buffer);

    await validateUpload({ ...validPngFile, buffer });

    expect(buffer).toEqual(original);
  });

  it("classifies Sharp pixel-limit failures as configured pixel errors", async () => {
    const buffer = await sharp({
      create: {
        width: 5_001,
        height: 5_001,
        channels: 3,
        background: { r: 0, g: 0, b: 0 }
      }
    })
      .png()
      .toBuffer();

    await expect(
      validateUpload({ buffer, mimetype: "image/png", size: buffer.length })
    ).rejects.toThrow(`maximum pixel count of ${MAX_PIXELS}`);
  });

  it("rejects a batch larger than the configured cap", () => {
    expect(() => validateBatchSize(6)).toThrow("Maximum batch size is 5");
  });

  it("accepts AVIF content when Sharp reports its HEIF container", async () => {
    const buffer = await sharp({
      create: {
        width: 1,
        height: 1,
        channels: 3,
        background: { r: 0, g: 0, b: 0 }
      }
    })
      .avif()
      .toBuffer();

    await expect(
      validateUpload({ buffer, mimetype: "image/avif", size: buffer.length })
    ).resolves.toMatchObject({ format: "avif" });
  });
});
