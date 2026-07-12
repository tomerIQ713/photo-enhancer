import fs from "node:fs";
import { randomUUID } from "node:crypto";
import express, { type Express, type Request, type Response } from "express";
import multer from "multer";
import { z } from "zod";
import { MAX_BATCH_SIZE, MAX_FILE_BYTES, MAX_PIXELS } from "./config";
import {
  UPLOAD_RATE_LIMIT_MAX,
  UPLOAD_RATE_LIMIT_WINDOW_MS,
  UPLOAD_MEMORY_BUDGET_BYTES,
  MAX_UPLOAD_MEMORY_RESERVATION_BYTES
} from "./config";
import { RateLimiter, UploadMemoryBudget } from "./admission";
import { CapacityError, JobStore } from "./jobs/job-store";
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
const controlsByTaskFieldSchema = z.string().optional();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_FILE_BYTES,
    files: MAX_BATCH_SIZE,
    fields: 4,
    parts: MAX_BATCH_SIZE + 4,
    fieldSize: 16_384
  }
});
const processUploadMemoryBudget = new UploadMemoryBudget({
  maxBytes: UPLOAD_MEMORY_BUDGET_BYTES,
  reservationBytes: MAX_UPLOAD_MEMORY_RESERVATION_BYTES
});

export interface CreateAppOptions {
  store?: JobStore;
  pipeline?: PipelineLike;
  cleanupIntervalMs?: number;
  now?: () => number;
  rateLimiter?: RateLimiter;
  uploadMemoryBudget?: UploadMemoryBudget;
}

export type PhotoEnhancerApp = Express & { close: () => void };

function parseControls(input: unknown): ManualControls {
  const field = controlsFieldSchema.parse(input);
  if (field === undefined || field.trim() === "") {
    return DEFAULT_CONTROLS;
  }
  return validateManualControls(JSON.parse(field));
}

function parseControlsByTask(input: unknown): ManualControls[] | undefined {
  const field = controlsByTaskFieldSchema.parse(input);
  if (field === undefined || field.trim() === "") return undefined;
  const parsed = JSON.parse(field);
  if (!Array.isArray(parsed)) throw new Error("Invalid per-image controls");
  return parsed.map((controls) => validateManualControls(controls));
}

function safeUploadError(error: unknown): string {
  if (error instanceof multer.MulterError) {
    if (error.code === "LIMIT_FILE_SIZE") {
      return "File too large. Each photo must be 10 MB or smaller.";
    }
    if (
      error.code === "LIMIT_FILE_COUNT" ||
      error.code === "LIMIT_PART_COUNT" ||
      error.code === "LIMIT_UNEXPECTED_FILE"
    ) {
      return `Choose between 1 and ${MAX_BATCH_SIZE} photos.`;
    }
    return "Invalid upload. Check the selected photo files and try again.";
  }

  const message = error instanceof Error ? error.message : "";
  if (/maximum size|file exceeds/i.test(message)) {
    return "File too large. Each photo must be 10 MB or smaller.";
  }
  if (/pixel/i.test(message)) {
    return `Image exceeds the ${MAX_PIXELS.toLocaleString("en-US")} pixel limit.`;
  }
  if (/unsupported image|accepted formats/i.test(message)) {
    return "Unsupported image. Accepted formats are JPEG, PNG, WebP, and AVIF.";
  }
  if (/batch|maximum batch|per-image controls/i.test(message)) {
    return `Choose between 1 and ${MAX_BATCH_SIZE} photos.`;
  }
  return "Invalid request";
}

function taskResponse(jobId: string, task: ImageTask): Record<string, unknown> {
  const response: Record<string, unknown> = {
    taskId: task.id,
    status: task.status,
    controls: task.controls
  };
  if (task.error) {
    response.error = task.error;
  }
  if (task.status === "complete" && task.outputPath) {
    try {
      response.result = {
        format: task.outputFormat,
        size: fs.statSync(task.outputPath).size,
        previewUrl: `/api/jobs/${encodeURIComponent(jobId)}/tasks/${encodeURIComponent(task.id)}/preview`
      };
    } catch {
      // A result may expire between status reads; omit its temporary metadata.
    }
  }
  return response;
}

function activeJob(
  store: JobStore,
  jobId: string,
  now: () => number
): { job?: ReturnType<JobStore["get"]>; expired: boolean } {
  return store.getActive(jobId, now());
}

export function createApp(options: CreateAppOptions = {}): PhotoEnhancerApp {
  const store = options.store ?? new JobStore();
  const pipeline = options.pipeline ?? new ProcessingPipeline();
  const now = options.now ?? Date.now;
  const processor = new JobProcessor(store, pipeline);
  const rateLimiter = options.rateLimiter ?? new RateLimiter({
    maxRequests: UPLOAD_RATE_LIMIT_MAX,
    windowMs: UPLOAD_RATE_LIMIT_WINDOW_MS
  });
  const uploadMemoryBudget = options.uploadMemoryBudget ?? processUploadMemoryBudget;
  const app = express() as PhotoEnhancerApp;
  app.set("trust proxy", false);
  const cleanupIntervalMs = options.cleanupIntervalMs ?? 60_000;
  const cleanupTimer = setInterval(() => store.removeExpired(now()), cleanupIntervalMs);
  cleanupTimer.unref();
  app.use("/api/jobs", (_request, response, next) => {
    response.setHeader("Cache-Control", "no-store, private");
    next();
  });

  app.post("/api/jobs", (request: Request, response: Response) => {
    const clientKey = request.ip || request.socket.remoteAddress || "unknown";
    if (!rateLimiter.allow(clientKey)) {
      response.status(429).json({ error: "Too many upload requests" });
      return;
    }
    if (!store.hasAdmissionCapacity()) {
      response.status(503).json({ error: "Service temporarily at capacity" });
      return;
    }
    const releaseUploadMemory = uploadMemoryBudget.tryAcquire();
    if (!releaseUploadMemory) {
      response.status(503).json({ error: "Service temporarily at upload capacity" });
      return;
    }
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      releaseUploadMemory();
    };
    request.once("aborted", release);
    request.once("error", release);
    request.once("close", release);
    response.once("close", release);
    upload.array("files", MAX_BATCH_SIZE)(request, response, async (error) => {
      release();
      if (error) {
        response.status(400).json({ error: safeUploadError(error) });
        return;
      }

      let preset: Preset;
      let controls: ManualControls;
      let outputFormat: OutputFormat;
      let controlsByTask: ManualControls[] | undefined;
      let acceptedFiles: Array<{
        id: string;
        buffer: Buffer;
        metadata: Awaited<ReturnType<typeof validateUpload>>;
      }>;
      try {
        const files = (request.files as Express.Multer.File[] | undefined) ?? [];
        validateBatchSize(files.length);
        preset = presetSchema.parse(request.body?.preset ?? "auto") as Preset;
        controls = parseControls(request.body?.controls);
        controlsByTask = parseControlsByTask(request.body?.controlsByTask);
        if (controlsByTask && controlsByTask.length !== files.length) {
          throw new Error("Invalid per-image controls");
        }
        outputFormat = outputFormatSchema.parse(
          request.body?.outputFormat ?? "png"
        ) as OutputFormat;
        acceptedFiles = [];
        for (const file of files) {
          const metadata = await validateUpload(file);
          acceptedFiles.push({
            id: randomUUID(),
            buffer: file.buffer,
            metadata
          });
        }
      } catch (error) {
        response.status(400).json({ error: safeUploadError(error) });
        return;
      }

      let job: ReturnType<JobStore["createFromBuffers"]>;
      try {
        job = store.createFromBuffers(
          acceptedFiles,
          preset,
          controls,
          outputFormat,
          controlsByTask
        );
      } catch (error) {
        if (error instanceof CapacityError) {
          response.status(503).json({ error: "Service temporarily at capacity" });
          return;
        }
        response.status(500).json({ error: "Internal server error" });
        return;
      }

      const failFirstTask =
        process.env.E2E_FAKE_PROCESSING === "true" &&
        request.get("x-e2e-retry") === "true";
      processor.startJob(job.id, { failFirstTask });
      response.status(202).json({
        jobId: job.id,
        tasks: job.tasks.map((task) => ({ taskId: task.id, status: task.status }))
      });
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
      tasks: result.job.tasks.map((task) => taskResponse(result.job!.id, task))
    });
  });

  app.get("/api/jobs/:jobId/tasks/:taskId/preview", (request, response) => {
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
    if (task.status !== "complete" || !task.outputPath) {
      response.status(404).json({ error: "Result not available" });
      return;
    }
    try {
      fs.statSync(task.outputPath);
    } catch {
      response.status(410).json({ error: "Result expired" });
      return;
    }
    const format = task.outputFormat ?? "png";
    response.type(format === "jpg" ? "jpg" : "png");
    fs.createReadStream(task.outputPath).on("error", () => {
      if (!response.headersSent) {
        response.status(410).json({ error: "Result expired" });
      } else {
        response.destroy();
      }
    }).pipe(response);
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
    const retryResult = processor.retryTask(result.job.id, task.id);
    if (retryResult === "expired") {
      response.status(410).json({ error: "Job expired" });
      return;
    }
    if (retryResult === "missing") {
      response.status(404).json({ error: "Task not found" });
      return;
    }
    if (retryResult === "not_failed") {
      response.status(409).json({ error: "Task is not retryable" });
      return;
    }
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
    try {
      fs.statSync(task.outputPath);
    } catch {
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
