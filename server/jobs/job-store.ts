import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  JOB_TTL_MS,
  MAX_OUTPUT_BYTES,
  MAX_QUEUED_TASKS,
  MAX_TRACKED_JOBS,
  TEMPORARY_STORAGE_BUDGET_BYTES
} from "../config";
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
  maxTrackedJobs?: number;
  maxQueuedTasks?: number;
  maxTemporaryStorageBytes?: number;
  maxOutputBytes?: number;
  maxExpiredIds?: number;
}

export class CapacityError extends Error {
  constructor(message = "Temporary processing capacity is full") {
    super(message);
    this.name = "CapacityError";
  }
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
      metadata: { ...task.metadata },
      controls: task.controls ? { ...task.controls } : undefined
    }))
  };
}

export class JobStore {
  private readonly jobs = new Map<string, Job>();
  private readonly expiredIds = new Map<string, number>();
  private readonly rootDir: string;
  private readonly ttlMs: number;
  private readonly now: () => number;
  private readonly maxTrackedJobs: number;
  private readonly maxQueuedTasks: number;
  private readonly maxTemporaryStorageBytes: number;
  private readonly maxOutputBytes: number;
  private readonly reservedBytes = new Map<string, number>();
  private readonly pendingCleanup = new Set<string>();
  private readonly maxExpiredIds: number;

  constructor(options: JobStoreOptions = {}) {
    this.rootDir = options.rootDir ?? DEFAULT_ROOT_DIR;
    this.ttlMs = options.ttlMs ?? JOB_TTL_MS;
    this.now = options.now ?? Date.now;
    this.maxTrackedJobs = options.maxTrackedJobs ?? MAX_TRACKED_JOBS;
    this.maxQueuedTasks = options.maxQueuedTasks ?? MAX_QUEUED_TASKS;
    this.maxTemporaryStorageBytes =
      options.maxTemporaryStorageBytes ?? TEMPORARY_STORAGE_BUDGET_BYTES;
    this.maxOutputBytes = options.maxOutputBytes ?? MAX_OUTPUT_BYTES;
    this.maxExpiredIds = options.maxExpiredIds ?? this.maxTrackedJobs * 2;
    this.sweepOrphanedJobs(this.now());
  }

  get size(): number {
    return this.jobs.size;
  }

  create(
    files: StoredUpload[],
    preset: Preset,
    controls: ManualControls,
    outputFormat: OutputFormat = "png",
    controlsByTask?: ManualControls[]
  ): Job {
    const buffers = files.map((file) => ({
      id: file.id,
      buffer: fs.readFileSync(file.originalPath),
      metadata: file.metadata
    }));
    return this.createFromBuffers(buffers, preset, controls, outputFormat, controlsByTask);
  }

  createFromBuffers(
    files: StoredBufferUpload[],
    preset: Preset,
    controls: ManualControls,
    outputFormat: OutputFormat = "png",
    controlsByTask?: ManualControls[]
  ): Job {
    const reservedBytes = files.reduce(
      (total, file) => total + file.buffer.length + this.maxOutputBytes,
      0
    );
    if (this.jobs.size >= this.maxTrackedJobs) {
      throw new CapacityError("Maximum tracked jobs reached");
    }
    if (this.queuedTaskCount + files.length > this.maxQueuedTasks) {
      throw new CapacityError("Maximum queued tasks reached");
    }
    if (this.currentReservedBytes + reservedBytes > this.maxTemporaryStorageBytes) {
      throw new CapacityError("Temporary storage budget reached");
    }
    const id = randomUUID();
    const createdAt = this.now();
    const jobDirectory = path.join(this.rootDir, id);
    const tasks = files.map((file, index) => {
      const taskId = randomUUID();
      return {
        id: taskId,
        originalPath: path.join(jobDirectory, `original-${taskId}.bin`),
        metadata: { ...file.metadata },
        status: "queued" as const,
        outputFormat,
        controls: { ...(controlsByTask?.[index] ?? controls) }
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
      this.reservedBytes.set(id, reservedBytes);
      return cloneJob(job);
    } catch (error) {
      try {
        fs.rmSync(jobDirectory, { recursive: true, force: true });
      } catch {
        this.pendingCleanup.add(jobDirectory);
      }
      throw error;
    }
  }

  get(id: string): Job | undefined {
    const job = this.jobs.get(id);
    return job ? cloneJob(job) : undefined;
  }

  getActive(id: string, now = this.now()): { job?: Job; expired: boolean } {
    const job = this.jobs.get(id);
    if (job && job.expiresAt <= now) {
      this.removeExpired(now);
      return { expired: true };
    }
    if (job) {
      return { job: cloneJob(job), expired: false };
    }
    return { expired: this.isExpired(id, now) };
  }

  get queuedTaskCount(): number {
    let count = 0;
    for (const job of this.jobs.values()) {
      count += job.tasks.filter((task) => task.status !== "complete" && task.status !== "failed").length;
    }
    return count;
  }

  get currentReservedBytes(): number {
    return [...this.reservedBytes.values()].reduce((total, bytes) => total + bytes, 0);
  }

  hasAdmissionCapacity(): boolean {
    return this.jobs.size < this.maxTrackedJobs && this.queuedTaskCount < this.maxQueuedTasks;
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
        this.reservedBytes.delete(id);
        this.expiredIds.set(id, this.now() + this.ttlMs + 1);
        while (this.expiredIds.size > this.maxExpiredIds) {
          const oldestId = this.expiredIds.keys().next().value as string | undefined;
          if (!oldestId) break;
          this.expiredIds.delete(oldestId);
        }
        removed += 1;
      } catch {
        // Keep the job for the next cleanup attempt.
      }
    }
    for (const directory of this.pendingCleanup) {
      try {
        fs.rmSync(directory, { recursive: true, force: true });
        this.pendingCleanup.delete(directory);
      } catch {
        // Retry during the next cleanup interval.
      }
    }
    this.sweepOrphanedJobs(now);
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
