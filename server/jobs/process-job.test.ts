import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MAX_OUTPUT_PIXELS } from "../config";
import { JobStore } from "./job-store";
import { JobProcessor, type PipelineLike } from "./process-job";
import type { ManualControls, OutputFormat, Preset } from "../types";

const controls: ManualControls = {
  strength: 50,
  sharpness: 50,
  noiseReduction: 50,
  brightness: 50,
  contrast: 50
};
const temporaryDirectories: string[] = [];

function createDirectory(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "photo-enhancer-processor-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

class DelayedPipeline implements PipelineLike {
  active = 0;
  maxActive = 0;
  calls = 0;

  async process(
    input: Buffer,
    _preset: Preset,
    _controls: ManualControls,
    _outputFormat: OutputFormat
  ): Promise<Buffer> {
    this.calls += 1;
    this.active += 1;
    this.maxActive = Math.max(this.maxActive, this.active);
    await new Promise((resolve) => setTimeout(resolve, 10));
    this.active -= 1;
    return input;
  }
}

async function waitForComplete(store: JobStore, jobId: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (store.get(jobId)?.tasks.every((task) => task.status === "complete" || task.status === "failed")) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("processor did not reach a terminal state");
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("JobProcessor", () => {
  it("limits concurrent batch processing while completing every task", async () => {
    const directory = createDirectory();
    const store = new JobStore({ rootDir: path.join(directory, "jobs") });
    const pipeline = new DelayedPipeline();
    const job = store.createFromBuffers(
      Array.from({ length: 5 }, (_, index) => ({
        id: `upload-${index}`,
        buffer: Buffer.from(`image-${index}`),
        metadata: { format: "png" as const, width: 2, height: 2, size: 7 }
      })),
      "auto",
      controls
    );

    new JobProcessor(store, pipeline, { concurrency: 2 }).startJob(job.id);
    await waitForComplete(store, job.id);

    expect(pipeline.calls).toBe(5);
    expect(pipeline.maxActive).toBeLessThanOrEqual(2);
  });

  it("fails unsafe upscale dimensions before invoking the pipeline", async () => {
    const directory = createDirectory();
    const store = new JobStore({ rootDir: path.join(directory, "jobs") });
    const pipeline = new DelayedPipeline();
    const sourcePixels = Math.ceil(MAX_OUTPUT_PIXELS / 16) + 1;
    const job = store.createFromBuffers(
      [{
        id: "oversized",
        buffer: Buffer.from("not decoded by the guarded preflight"),
        metadata: {
          format: "png",
          width: sourcePixels,
          height: 1,
          size: 36
        }
      }],
      "upscale",
      controls
    );

    new JobProcessor(store, pipeline).startJob(job.id);
    await waitForComplete(store, job.id);

    expect(pipeline.calls).toBe(0);
    expect(store.get(job.id)?.tasks[0]).toMatchObject({
      status: "failed",
      error: "Processing failed"
    });
  });

  it.each([
    [5_000_000, 2_500, 2_000],
    [12_000_000, 4_000, 3_000]
  ])("processes a %s-pixel Auto Enhance image within the input limit", async (_pixels, width, height) => {
    const directory = createDirectory();
    const store = new JobStore({ rootDir: path.join(directory, "jobs") });
    const pipeline = new DelayedPipeline();
    const job = store.createFromBuffers(
      [{
        id: `auto-${width}`,
        buffer: Buffer.from("valid-enough-for-test-pipeline"),
        metadata: { format: "png", width, height, size: 32 }
      }],
      "auto",
      controls
    );

    new JobProcessor(store, pipeline).startJob(job.id);
    await waitForComplete(store, job.id);

    expect(pipeline.calls).toBe(1);
    expect(store.get(job.id)?.tasks[0].status).toBe("complete");
  });

  it("fails output buffers over the configured byte limit", async () => {
    const directory = createDirectory();
    const store = new JobStore({ rootDir: path.join(directory, "jobs") });
    const pipeline: PipelineLike = {
      async process() {
        return Buffer.from("too large");
      }
    };
    const job = store.createFromBuffers(
      [{
        id: "large-output",
        buffer: Buffer.from("input"),
        metadata: { format: "png", width: 2, height: 2, size: 5 }
      }],
      "auto",
      controls
    );

    new JobProcessor(store, pipeline, { maxOutputBytes: 4 }).startJob(job.id);
    await waitForComplete(store, job.id);

    expect(store.get(job.id)?.tasks[0]).toMatchObject({
      status: "failed",
      error: "Processing failed"
    });
  });
});
