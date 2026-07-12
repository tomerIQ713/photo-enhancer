import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
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

const SAFE_PROCESSING_ERROR = "Processing failed";

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
  taskId: string
): Promise<void> {
  const job = store.get(jobId);
  const task = job?.tasks.find((candidate) => candidate.id === taskId);
  if (!job || !task) {
    return;
  }

  let temporaryOutputPath: string | undefined;
  try {
    markTaskSafely(store, jobId, taskId, { status: "analyzing", error: undefined });
    const input = await fs.readFile(task.originalPath);
    markTaskSafely(store, jobId, taskId, { status: "processing" });
    const output = await pipeline.process(
      input,
      job.preset,
      job.controls,
      task.outputFormat ?? "png"
    );
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
  constructor(
    private readonly store: JobStore,
    private readonly pipeline: PipelineLike = new ProcessingPipeline()
  ) {}

  startJob(jobId: string): void {
    const job = this.store.get(jobId);
    if (!job) {
      return;
    }
    for (const task of job.tasks) {
      void processTask(this.store, this.pipeline, jobId, task.id);
    }
  }

  retryTask(jobId: string, taskId: string): void {
    this.store.markTask(jobId, taskId, {
      status: "queued",
      error: undefined,
      outputPath: undefined
    });
    void processTask(this.store, this.pipeline, jobId, taskId);
  }
}
