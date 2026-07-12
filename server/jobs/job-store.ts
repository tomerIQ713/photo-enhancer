import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { JOB_TTL_MS } from "../config";
import type {
  ImageMetadata,
  Job,
  ManualControls,
  OutputFormat,
  Preset,
  StoredUpload,
  TaskUpdate
} from "../types";

export interface StoredBufferUpload {
  id: string;
  buffer: Buffer;
  metadata: ImageMetadata;
}

export interface JobStoreOptions {
  rootDir?: string;
  ttlMs?: number;
  now?: () => number;
}

const DEFAULT_ROOT_DIR = path.join(os.tmpdir(), "photo-enhancer");
const UUID_DIRECTORY_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function cloneJob(job: Job): Job {
  return {
    ...job,
    controls: { ...job.controls },
    tasks: job.tasks.map((task) => ({
      ...task,
      metadata: { ...task.metadata }
    }))
  };
}

export class JobStore {
  private readonly jobs = new Map<string, Job>();
  private readonly expiredIds = new Map<string, number>();
  private readonly rootDir: string;
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(options: JobStoreOptions = {}) {
    this.rootDir = options.rootDir ?? DEFAULT_ROOT_DIR;
    this.ttlMs = options.ttlMs ?? JOB_TTL_MS;
    this.now = options.now ?? Date.now;
    this.sweepOrphanedJobs(this.now());
  }

  get size(): number {
    return this.jobs.size;
  }

  create(
    files: StoredUpload[],
    preset: Preset,
    controls: ManualControls,
    outputFormat: OutputFormat = "png"
  ): Job {
    const buffers = files.map((file) => ({
      id: file.id,
      buffer: fs.readFileSync(file.originalPath),
      metadata: file.metadata
    }));
    return this.createFromBuffers(buffers, preset, controls, outputFormat);
  }

  createFromBuffers(
    files: StoredBufferUpload[],
    preset: Preset,
    controls: ManualControls,
    outputFormat: OutputFormat = "png"
  ): Job {
    const id = randomUUID();
    const createdAt = this.now();
    const jobDirectory = path.join(this.rootDir, id);
    const tasks = files.map((file) => {
      const taskId = randomUUID();
      return {
        id: taskId,
        originalPath: path.join(jobDirectory, `original-${taskId}.bin`),
        metadata: { ...file.metadata },
        status: "queued" as const,
        outputFormat
      };
    });
    const job: Job = {
      id,
      preset,
      controls: { ...controls },
      tasks,
      createdAt,
      expiresAt: createdAt + this.ttlMs
    };

    try {
      this.expiredIds.delete(id);
      fs.mkdirSync(jobDirectory, { recursive: true, mode: 0o700 });
      for (const [index, file] of files.entries()) {
        fs.writeFileSync(tasks[index].originalPath, file.buffer, { mode: 0o600 });
      }
      this.jobs.set(id, job);
      return cloneJob(job);
    } catch (error) {
      fs.rmSync(jobDirectory, { recursive: true, force: true });
      throw error;
    }
  }

  get(id: string): Job | undefined {
    const job = this.jobs.get(id);
    return job ? cloneJob(job) : undefined;
  }

  isExpired(id: string, now = this.now()): boolean {
    this.pruneExpiredIds(now);
    const job = this.jobs.get(id);
    if (job) {
      return job.expiresAt <= now;
    }
    const expiresAt = this.expiredIds.get(id);
    return expiresAt !== undefined && expiresAt > now;
  }

  markTask(id: string, taskId: string, update: TaskUpdate): void {
    const job = this.jobs.get(id);
    const task = job?.tasks.find((candidate) => candidate.id === taskId);
    if (!task) {
      throw new Error("Job or task not found");
    }

    Object.assign(task, update);
  }

  getOutputFormat(id: string): OutputFormat | undefined {
    return this.jobs.get(id)?.tasks[0]?.outputFormat;
  }

  retryTask(
    id: string,
    taskId: string,
    now = this.now()
  ): "queued" | "expired" | "missing" | "not_failed" {
    if (this.isExpired(id, now)) {
      return "expired";
    }
    const job = this.jobs.get(id);
    const task = job?.tasks.find((candidate) => candidate.id === taskId);
    if (!job || !task) {
      return "missing";
    }
    if (task.status !== "failed") {
      return "not_failed";
    }

    Object.assign(task, {
      status: "queued" as const,
      error: undefined,
      outputPath: undefined
    });
    return "queued";
  }

  removeExpired(now = this.now()): number {
    let removed = 0;
    this.pruneExpiredIds(now);
    for (const [id, job] of this.jobs.entries()) {
      if (job.expiresAt > now) {
        continue;
      }

      try {
        fs.rmSync(path.join(this.rootDir, id), { recursive: true, force: true });
        this.jobs.delete(id);
        this.expiredIds.set(id, job.expiresAt + this.ttlMs);
        removed += 1;
      } catch {
        // Keep the job for the next cleanup attempt.
      }
    }
    return removed;
  }

  private pruneExpiredIds(now: number): void {
    for (const [id, expiresAt] of this.expiredIds.entries()) {
      if (expiresAt <= now) {
        this.expiredIds.delete(id);
      }
    }
  }

  private sweepOrphanedJobs(now: number): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(this.rootDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || !UUID_DIRECTORY_PATTERN.test(entry.name)) {
        continue;
      }
      const directory = path.join(this.rootDir, entry.name);
      try {
        const stats = fs.statSync(directory);
        if (now - stats.mtimeMs >= this.ttlMs) {
          fs.rmSync(directory, { recursive: true, force: true });
        }
      } catch {
        // A startup sweep is best-effort and never blocks server startup.
      }
    }
  }
}
