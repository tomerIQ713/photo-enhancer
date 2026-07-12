import fs from "node:fs";
import { randomUUID } from "node:crypto";
import express, { type Express, type Request, type Response } from "express";
import multer from "multer";
import { z } from "zod";
import { MAX_BATCH_SIZE, MAX_FILE_BYTES } from "./config";
import { JobStore } from "./jobs/job-store";
import { JobProcessor, type PipelineLike } from "./jobs/process-job";
import { ProcessingPipeline } from "./processing/pipeline";
import { validateBatchSize, validateManualControls, validateUpload } from "./validation";
import type { ImageTask, ManualControls, OutputFormat, Preset } from "./types";

const DEFAULT_CONTROLS: ManualControls = {
  strength: 50,
  sharpness: 50,
  noiseReduction: 50,
  brightness: 50,
  contrast: 50
};

const presetSchema = z.enum(["auto", "upscale"]);
const outputFormatSchema = z.enum(["jpg", "png"]);
const controlsFieldSchema = z.string().optional();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_FILE_BYTES,
    files: MAX_BATCH_SIZE,
    fields: 3,
    parts: MAX_BATCH_SIZE + 3,
    fieldSize: 16_384
  }
});

export interface CreateAppOptions {
  store?: JobStore;
  pipeline?: PipelineLike;
  cleanupIntervalMs?: number;
  now?: () => number;
}

export type PhotoEnhancerApp = Express & { close: () => void };

function parseControls(input: unknown): ManualControls {
  const field = controlsFieldSchema.parse(input);
  if (field === undefined || field.trim() === "") {
    return DEFAULT_CONTROLS;
  }
  return validateManualControls(JSON.parse(field));
}

function validationMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Invalid request";
}

function isExpired(store: JobStore, jobId: string, now: () => number): boolean {
  const job = store.get(jobId);
  if (!job) {
    return store.isExpired(jobId);
  }
  if (job.expiresAt > now()) {
    return false;
  }
  store.removeExpired(now());
  return true;
}

function taskResponse(task: ImageTask): Record<string, unknown> {
  const response: Record<string, unknown> = {
    taskId: task.id,
    status: task.status
  };
  if (task.error) {
    response.error = task.error;
  }
  if (task.status === "complete" && task.outputPath && fs.existsSync(task.outputPath)) {
    response.result = {
      format: task.outputFormat,
      size: fs.statSync(task.outputPath).size
    };
  }
  return response;
}

function activeJob(
  store: JobStore,
  jobId: string,
  now: () => number
): { job: ReturnType<JobStore["get"]>; expired: boolean } {
  if (isExpired(store, jobId, now)) {
    return { job: undefined, expired: true };
  }
  return { job: store.get(jobId), expired: false };
}

export function createApp(options: CreateAppOptions = {}): PhotoEnhancerApp {
  const store = options.store ?? new JobStore();
  const pipeline = options.pipeline ?? new ProcessingPipeline();
  const now = options.now ?? Date.now;
  const processor = new JobProcessor(store, pipeline);
  const app = express() as PhotoEnhancerApp;
  const cleanupIntervalMs = options.cleanupIntervalMs ?? 60_000;
  const cleanupTimer = setInterval(() => store.removeExpired(now()), cleanupIntervalMs);
  cleanupTimer.unref();

  app.post("/api/jobs", (request: Request, response: Response) => {
    upload.array("files", MAX_BATCH_SIZE)(request, response, async (error) => {
      if (error) {
        response.status(400).json({ error: "Invalid upload" });
        return;
      }

      try {
        const files = (request.files as Express.Multer.File[] | undefined) ?? [];
        validateBatchSize(files.length);
        const preset = presetSchema.parse(request.body?.preset ?? "auto") as Preset;
        const controls = parseControls(request.body?.controls);
        const outputFormat = outputFormatSchema.parse(
          request.body?.outputFormat ?? "png"
        ) as OutputFormat;
        const acceptedFiles = [];
        for (const file of files) {
          const metadata = await validateUpload(file);
          acceptedFiles.push({
            id: randomUUID(),
            buffer: file.buffer,
            metadata
          });
        }
        const job = store.createFromBuffers(
          acceptedFiles,
          preset,
          controls,
          outputFormat
        );
        processor.startJob(job.id);
        response.status(202).json({
          jobId: job.id,
          tasks: job.tasks.map((task) => ({ taskId: task.id, status: task.status }))
        });
      } catch (caughtError) {
        response.status(400).json({ error: validationMessage(caughtError) });
      }
    });
  });

  app.get("/api/jobs/:jobId", (request, response) => {
    const result = activeJob(store, request.params.jobId, now);
    if (result.expired) {
      response.status(410).json({ error: "Job expired" });
      return;
    }
    if (!result.job) {
      response.status(404).json({ error: "Job not found" });
      return;
    }
    response.json({
      jobId: result.job.id,
      preset: result.job.preset,
      controls: result.job.controls,
      createdAt: result.job.createdAt,
      expiresAt: result.job.expiresAt,
      tasks: result.job.tasks.map(taskResponse)
    });
  });

  app.post("/api/jobs/:jobId/tasks/:taskId/retry", (request, response) => {
    const result = activeJob(store, request.params.jobId, now);
    if (result.expired) {
      response.status(410).json({ error: "Job expired" });
      return;
    }
    if (!result.job) {
      response.status(404).json({ error: "Job not found" });
      return;
    }
    const task = result.job.tasks.find((candidate) => candidate.id === request.params.taskId);
    if (!task) {
      response.status(404).json({ error: "Task not found" });
      return;
    }
    if (task.status !== "failed") {
      response.status(409).json({ error: "Task is not retryable" });
      return;
    }
    processor.retryTask(result.job.id, task.id);
    response.status(202).json({ taskId: task.id, status: "queued" });
  });

  app.get("/api/jobs/:jobId/tasks/:taskId/download", (request, response) => {
    const result = activeJob(store, request.params.jobId, now);
    if (result.expired) {
      response.status(410).json({ error: "Result expired" });
      return;
    }
    if (!result.job) {
      response.status(404).json({ error: "Job not found" });
      return;
    }
    const task = result.job.tasks.find((candidate) => candidate.id === request.params.taskId);
    if (!task) {
      response.status(404).json({ error: "Task not found" });
      return;
    }
    const requestedFormat = request.query.format;
    let format: OutputFormat;
    try {
      format = outputFormatSchema.parse(requestedFormat ?? task.outputFormat ?? "png");
    } catch {
      response.status(400).json({ error: "Invalid output format" });
      return;
    }
    if (format !== task.outputFormat) {
      response.status(400).json({ error: "Requested format does not match the result" });
      return;
    }
    if (task.status !== "complete" || !task.outputPath) {
      response.status(404).json({ error: "Result not available" });
      return;
    }
    if (!fs.existsSync(task.outputPath)) {
      response.status(410).json({ error: "Result expired" });
      return;
    }
    response.type(format === "jpg" ? "jpg" : "png");
    response.setHeader(
      "Content-Disposition",
      `attachment; filename="photo-enhanced.${format}"`
    );
    fs.createReadStream(task.outputPath).on("error", () => {
      if (!response.headersSent) {
        response.status(410).json({ error: "Result expired" });
      } else {
        response.destroy();
      }
    }).pipe(response);
  });

  app.close = () => clearInterval(cleanupTimer);
  return app;
}

export const app = createApp();
