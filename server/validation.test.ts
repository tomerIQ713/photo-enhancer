import { describe, expect, it } from "vitest";
import sharp from "sharp";
import {
  validateBatchSize,
  validateUpload
} from "./validation";

const validPngFile = {
  buffer: Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64"
  ),
  mimetype: "image/png",
  size: 68
};

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
