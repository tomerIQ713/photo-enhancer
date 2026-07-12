const DEFAULT_MAX_FILE_BYTES = 10_485_760;
const DEFAULT_MAX_PIXELS = 25_000_000;
const DEFAULT_MAX_BATCH_SIZE = 5;
const DEFAULT_MAX_OUTPUT_PIXELS = 50_000_000;
const DEFAULT_MAX_OUTPUT_BYTES = 50_000_000;
const DEFAULT_PROCESSING_CONCURRENCY = 2;
const MAX_PROCESSING_CONCURRENCY = 2;
const DEFAULT_JOB_TTL_MS = 3_600_000;
const DEFAULT_OPENROUTER_TIMEOUT_MS = 60_000;
const DEFAULT_OPENROUTER_MODEL = "google/gemini-2.5-flash";
const DEFAULT_MAX_TRACKED_JOBS = 100;
const DEFAULT_MAX_QUEUED_TASKS = 200;
const DEFAULT_TEMPORARY_STORAGE_BUDGET_BYTES = 500_000_000;
const DEFAULT_UPLOAD_RATE_LIMIT_MAX = 10;
const DEFAULT_UPLOAD_RATE_LIMIT_WINDOW_MS = 60_000;
const DEFAULT_UPLOAD_MEMORY_BUDGET_BYTES = 100_000_000;
const UPLOAD_MULTIPART_OVERHEAD_BYTES = 64 * 1024;

function readPositiveInteger(name: string, fallback: number): number {
  const value = process.env[name];

  if (value === undefined || value === "") {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }

  return parsed;
}

export const MAX_FILE_BYTES = readPositiveInteger(
  "MAX_FILE_BYTES",
  DEFAULT_MAX_FILE_BYTES
);
export const MAX_PIXELS = readPositiveInteger("MAX_PIXELS", DEFAULT_MAX_PIXELS);
export const MAX_BATCH_SIZE = readPositiveInteger(
  "MAX_BATCH_SIZE",
  DEFAULT_MAX_BATCH_SIZE
);
export const MAX_OUTPUT_PIXELS = readPositiveInteger(
  "MAX_OUTPUT_PIXELS",
  DEFAULT_MAX_OUTPUT_PIXELS
);
export const MAX_OUTPUT_BYTES = readPositiveInteger(
  "MAX_OUTPUT_BYTES",
  DEFAULT_MAX_OUTPUT_BYTES
);
export const PROCESSING_CONCURRENCY = Math.min(
  readPositiveInteger("PROCESSING_CONCURRENCY", DEFAULT_PROCESSING_CONCURRENCY),
  MAX_PROCESSING_CONCURRENCY
);
export const JOB_TTL_MS = readPositiveInteger("JOB_TTL_MS", DEFAULT_JOB_TTL_MS);
export const OPENROUTER_TIMEOUT_MS = readPositiveInteger(
  "OPENROUTER_TIMEOUT_MS",
  DEFAULT_OPENROUTER_TIMEOUT_MS
);
export const OPENROUTER_MODEL =
  process.env.OPENROUTER_MODEL || DEFAULT_OPENROUTER_MODEL;
export const MAX_TRACKED_JOBS = readPositiveInteger(
  "MAX_TRACKED_JOBS",
  DEFAULT_MAX_TRACKED_JOBS
);
export const MAX_QUEUED_TASKS = readPositiveInteger(
  "MAX_QUEUED_TASKS",
  DEFAULT_MAX_QUEUED_TASKS
);
export const TEMPORARY_STORAGE_BUDGET_BYTES = readPositiveInteger(
  "TEMPORARY_STORAGE_BUDGET_BYTES",
  DEFAULT_TEMPORARY_STORAGE_BUDGET_BYTES
);
export const UPLOAD_RATE_LIMIT_MAX = readPositiveInteger(
  "UPLOAD_RATE_LIMIT_MAX",
  DEFAULT_UPLOAD_RATE_LIMIT_MAX
);
export const UPLOAD_RATE_LIMIT_WINDOW_MS = readPositiveInteger(
  "UPLOAD_RATE_LIMIT_WINDOW_MS",
  DEFAULT_UPLOAD_RATE_LIMIT_WINDOW_MS
);
export const UPLOAD_MEMORY_BUDGET_BYTES = readPositiveInteger(
  "UPLOAD_MEMORY_BUDGET_BYTES",
  DEFAULT_UPLOAD_MEMORY_BUDGET_BYTES
);
export const MAX_UPLOAD_MEMORY_RESERVATION_BYTES =
  MAX_FILE_BYTES * MAX_BATCH_SIZE + UPLOAD_MULTIPART_OVERHEAD_BYTES;

export const config = {
  maxFileBytes: MAX_FILE_BYTES,
  maxPixels: MAX_PIXELS,
  maxBatchSize: MAX_BATCH_SIZE,
  maxOutputPixels: MAX_OUTPUT_PIXELS,
  maxOutputBytes: MAX_OUTPUT_BYTES,
  processingConcurrency: PROCESSING_CONCURRENCY,
  jobTtlMs: JOB_TTL_MS,
  openRouterTimeoutMs: OPENROUTER_TIMEOUT_MS,
  openRouterModel: OPENROUTER_MODEL,
  maxTrackedJobs: MAX_TRACKED_JOBS,
  maxQueuedTasks: MAX_QUEUED_TASKS,
  temporaryStorageBudgetBytes: TEMPORARY_STORAGE_BUDGET_BYTES,
  uploadRateLimitMax: UPLOAD_RATE_LIMIT_MAX,
  uploadRateLimitWindowMs: UPLOAD_RATE_LIMIT_WINDOW_MS,
  uploadMemoryBudgetBytes: UPLOAD_MEMORY_BUDGET_BYTES,
  maxUploadMemoryReservationBytes: MAX_UPLOAD_MEMORY_RESERVATION_BYTES
} as const;
