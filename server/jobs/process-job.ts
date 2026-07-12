import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  MAX_OUTPUT_BYTES,
  MAX_OUTPUT_PIXELS,
  PROCESSING_CONCURRENCY
} from "../config";
import { JobStore } from "./job-store";
import { ProcessingPipeline } from "../processing/pipeline";

export interface PipelineLike {
  process(
    input: Buffer,
    preset: Parameters<ProcessingPipeline["process"]>[1],
    controls: Parameters<ProcessingPipeline["process"]>[2],
    outputFormat: Parameters<ProcessingPipeline["process"]>[3]
  ): Promise<Buffer>;
}

export interface JobProcessorOptions {
  concurrency?: number;
  maxOutputPixels?: number;
  maxOutputBytes?: number;
}

export interface StartJobOptions {
  failFirstTask?: boolean;
}

const SAFE_PROCESSING_ERROR = "Processing failed";

function maxEffectiveScale(preset: Parameters<ProcessingPipeline["process"]>[1]): number {
  return preset === "auto" ? 1 : 4;
}

function markTaskSafely(
  store: JobStore,
  jobId: string,
  taskId: string,
  update: Parameters<JobStore["markTask"]>[2]
): void {
  try {
    store.markTask(jobId, taskId, update);
  } catch {
    // Cleanup may remove the job while a task is still finishing.
  }
}

async function processTask(
  store: JobStore,
  pipeline: PipelineLike,
  jobId: string,
  taskId: string,
  maxOutputPixels: number,
  maxOutputBytes: number,
  failFirstProcessing: boolean
): Promise<void> {
  const job = store.get(jobId);
  const task = job?.tasks.find((candidate) => candidate.id === taskId);
  if (!job || !task) {
    return;
  }

  let temporaryOutputPath: string | undefined;
  try {
    if (failFirstProcessing) {
      throw new Error("E2E fake processing failure");
    }

    markTaskSafely(store, jobId, taskId, { status: "analyzing", error: undefined });
    const sourcePixels = task.metadata.width * task.metadata.height;
    const effectiveScale = maxEffectiveScale(job.preset);
    if (
      !Number.isSafeInteger(sourcePixels) ||
      sourcePixels > maxOutputPixels / (effectiveScale * effectiveScale)
    ) {
      throw new Error("Output pixel limit exceeded");
    }
    const input = await fs.readFile(task.originalPath);
    markTaskSafely(store, jobId, taskId, { status: "processing" });
    const output = await pipeline.process(
      input,
      job.preset,
      task.controls ?? job.controls,
      task.outputFormat ?? "png"
    );
    if (!Buffer.isBuffer(output) || output.length > maxOutputBytes) {
      throw new Error("Output byte limit exceeded");
    }
    const outputPath = path.join(
      path.dirname(task.originalPath),
      `output-${task.id}.${task.outputFormat ?? "png"}`
    );
    temporaryOutputPath = `${outputPath}.tmp-${randomUUID()}`;
    await fs.writeFile(temporaryOutputPath, output, { mode: 0o600 });
    await fs.rename(temporaryOutputPath, outputPath);
    temporaryOutputPath = undefined;
    markTaskSafely(store, jobId, taskId, {
      status: "complete",
      outputPath
    });
  } catch {
    if (temporaryOutputPath) {
      await fs.rm(temporaryOutputPath, { force: true }).catch(() => undefined);
    }
    markTaskSafely(store, jobId, taskId, {
      status: "failed",
      error: SAFE_PROCESSING_ERROR,
      outputPath: undefined
    });
  }
}

export class JobProcessor {
  private readonly concurrency: number;
  private readonly maxOutputPixels: number;
  private readonly maxOutputBytes: number;
  private readonly queue: Array<{
    jobId: string;
    taskId: string;
    failFirstProcessing: boolean;
  }> = [];
  private readonly queued = new Set<string>();
  private active = 0;

  constructor(
    private readonly store: JobStore,
    private readonly pipeline: PipelineLike = new ProcessingPipeline(),
    options: JobProcessorOptions = {}
  ) {
    this.concurrency = Math.max(
      1,
      Math.min(options.concurrency ?? PROCESSING_CONCURRENCY, PROCESSING_CONCURRENCY)
    );
    this.maxOutputPixels = options.maxOutputPixels ?? MAX_OUTPUT_PIXELS;
    this.maxOutputBytes = options.maxOutputBytes ?? MAX_OUTPUT_BYTES;
  }

  startJob(jobId: string, options: StartJobOptions = {}): void {
    const job = this.store.get(jobId);
    if (!job) {
      return;
    }
    for (const [index, task] of job.tasks.entries()) {
      this.enqueue(jobId, task.id, options.failFirstTask === true && index === 0);
    }
  }

  retryTask(jobId: string, taskId: string): ReturnType<JobStore["retryTask"]> {
    const result = this.store.retryTask(jobId, taskId);
    if (result === "queued") {
      this.enqueue(jobId, taskId, false);
    }
    return result;
  }

  private enqueue(jobId: string, taskId: string, failFirstProcessing: boolean): void {
    const key = `${jobId}:${taskId}`;
    if (this.queued.has(key)) {
      return;
    }
    this.queued.add(key);
    this.queue.push({ jobId, taskId, failFirstProcessing });
    this.drain();
  }

  private drain(): void {
    while (this.active < this.concurrency && this.queue.length > 0) {
      const task = this.queue.shift();
      if (!task) {
        return;
      }
      const key = `${task.jobId}:${task.taskId}`;
      this.queued.delete(key);
      this.active += 1;
      void processTask(
        this.store,
        this.pipeline,
        task.jobId,
        task.taskId,
        this.maxOutputPixels,
        this.maxOutputBytes,
        task.failFirstProcessing
      ).finally(() => {
        this.active -= 1;
        this.drain();
      });
    }
  }
}
