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
  private readonly expiredIds = new Set<string>();
  private readonly rootDir: string;
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(options: JobStoreOptions = {}) {
    this.rootDir = options.rootDir ?? DEFAULT_ROOT_DIR;
    this.ttlMs = options.ttlMs ?? JOB_TTL_MS;
    this.now = options.now ?? Date.now;
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

  isExpired(id: string): boolean {
    return this.expiredIds.has(id);
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

  removeExpired(now = this.now()): number {
    let removed = 0;
    for (const [id, job] of this.jobs.entries()) {
      if (job.expiresAt > now) {
        continue;
      }

      fs.rmSync(path.join(this.rootDir, id), { recursive: true, force: true });
      this.jobs.delete(id);
      this.expiredIds.add(id);
      removed += 1;
    }
    return removed;
  }
}
