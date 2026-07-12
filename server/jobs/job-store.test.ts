import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";
import { JobStore } from "./job-store";
import type { ManualControls, StoredUpload } from "../types";

const defaultControls: ManualControls = {
  strength: 70,
  sharpness: 60,
  noiseReduction: 30,
  brightness: 50,
  contrast: 50
};

const tempDirectories: string[] = [];

function createTempDirectory(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "photo-enhancer-store-test-"));
  tempDirectories.push(directory);
  return directory;
}

async function createSamplePng(): Promise<Buffer> {
  return sharp({
    create: {
      width: 2,
      height: 2,
      channels: 3,
      background: { r: 120, g: 80, b: 40 }
    }
  })
    .png()
    .toBuffer();
}

function upload(originalPath: string, id: string): StoredUpload {
  return {
    id,
    originalPath,
    metadata: {
      format: "png",
      width: 2,
      height: 2,
      size: fs.statSync(originalPath).size
    }
  };
}

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("JobStore", () => {
  it("creates a queued task for every accepted file", async () => {
    const directory = createTempDirectory();
    const firstPath = path.join(directory, "first.png");
    const secondPath = path.join(directory, "second.png");
    const sample = await createSamplePng();
    fs.writeFileSync(firstPath, sample);
    fs.writeFileSync(secondPath, sample);
    const store = new JobStore({ rootDir: path.join(directory, "jobs") });

    const job = store.create(
      [upload(firstPath, "upload-a"), upload(secondPath, "upload-b")],
      "auto",
      defaultControls
    );

    expect(job.tasks.map((task) => task.status)).toEqual(["queued", "queued"]);
    expect(new Set([job.id, ...job.tasks.map((task) => task.id)])).toHaveLength(3);
    expect(job.tasks.every((task) => fs.existsSync(task.originalPath))).toBe(true);
  });

  it("removes expired jobs and their temporary files idempotently", async () => {
    const directory = createTempDirectory();
    const originalPath = path.join(directory, "first.png");
    fs.writeFileSync(originalPath, await createSamplePng());
    const store = new JobStore({
      rootDir: path.join(directory, "jobs"),
      ttlMs: 100,
      now: () => 1_000
    });
    const job = store.create([upload(originalPath, "upload-a")], "auto", defaultControls);
    const expiredPath = job.tasks[0].originalPath;

    expect(store.removeExpired(1_100)).toBe(1);
    expect(fs.existsSync(expiredPath)).toBe(false);
    expect(store.get(job.id)).toBeUndefined();
    expect(store.removeExpired(1_100)).toBe(0);
  });

  it("writes validated buffers into a private job directory", async () => {
    const directory = createTempDirectory();
    const store = new JobStore({ rootDir: path.join(directory, "jobs") });
    const sample = await createSamplePng();

    const job = store.createFromBuffers(
      [{ id: "upload-a", buffer: sample, metadata: {
        format: "png",
        width: 2,
        height: 2,
        size: sample.length
      } }],
      "upscale",
      defaultControls,
      "jpg"
    );

    expect(job.tasks[0].originalPath).toContain(path.join("jobs", job.id));
    expect(fs.readFileSync(job.tasks[0].originalPath)).toEqual(sample);
    expect(store.getOutputFormat(job.id)).toBe("jpg");
  });
});
