import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";
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

  it("prunes expired identifiers after a finite retention window", async () => {
    const directory = createTempDirectory();
    const originalPath = path.join(directory, "first.png");
    fs.writeFileSync(originalPath, await createSamplePng());
    const store = new JobStore({
      rootDir: path.join(directory, "jobs"),
      ttlMs: 100,
      now: () => 1_000
    });
    const job = store.create([upload(originalPath, "upload-a")], "auto", defaultControls);

    store.removeExpired(1_100);

    expect(store.isExpired(job.id, 1_100)).toBe(true);
    expect(store.isExpired(job.id, 1_201)).toBe(false);
  });

  it("sweeps only old UUID job directories during startup", () => {
    const directory = createTempDirectory();
    const rootDir = path.join(directory, "jobs");
    const oldJobDir = path.join(rootDir, randomUUID());
    const recentJobDir = path.join(rootDir, randomUUID());
    const unrelatedDir = path.join(rootDir, "keep-me");
    fs.mkdirSync(oldJobDir, { recursive: true });
    fs.mkdirSync(recentJobDir, { recursive: true });
    fs.mkdirSync(unrelatedDir, { recursive: true });
    fs.utimesSync(oldJobDir, 0.7, 0.7);
    fs.utimesSync(recentJobDir, 0.95, 0.95);
    fs.utimesSync(unrelatedDir, 0.7, 0.7);

    new JobStore({ rootDir, ttlMs: 100, now: () => 1_000 });

    expect(fs.existsSync(oldJobDir)).toBe(false);
    expect(fs.existsSync(recentJobDir)).toBe(true);
    expect(fs.existsSync(unrelatedDir)).toBe(true);
  });

  it("keeps a failed cleanup job retryable without escaping filesystem errors", async () => {
    const directory = createTempDirectory();
    const originalPath = path.join(directory, "first.png");
    fs.writeFileSync(originalPath, await createSamplePng());
    const store = new JobStore({
      rootDir: path.join(directory, "jobs"),
      ttlMs: 100,
      now: () => 1_000
    });
    const job = store.create([upload(originalPath, "upload-a")], "auto", defaultControls);
    const removeSpy = vi.spyOn(fs, "rmSync").mockImplementationOnce(() => {
      throw new Error("private filesystem failure");
    });

    expect(() => store.removeExpired(1_100)).not.toThrow();
    expect(store.get(job.id)).toBeDefined();
    expect(store.removeExpired(1_100)).toBe(1);

    removeSpy.mockRestore();
  });

  it("returns an expired transition instead of throwing when retry races cleanup", async () => {
    const directory = createTempDirectory();
    const originalPath = path.join(directory, "first.png");
    fs.writeFileSync(originalPath, await createSamplePng());
    const store = new JobStore({
      rootDir: path.join(directory, "jobs"),
      ttlMs: 100,
      now: () => 1_000
    });
    const job = store.create([upload(originalPath, "upload-a")], "auto", defaultControls);
    const taskId = job.tasks[0].id;
    store.markTask(job.id, taskId, { status: "failed", error: "Processing failed" });
    store.removeExpired(1_100);

    expect(store.retryTask(job.id, taskId, 1_100)).toBe("expired");
  });
});
