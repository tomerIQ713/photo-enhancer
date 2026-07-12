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

export const config = {
  maxFileBytes: MAX_FILE_BYTES,
  maxPixels: MAX_PIXELS,
  maxBatchSize: MAX_BATCH_SIZE,
  maxOutputPixels: MAX_OUTPUT_PIXELS,
  maxOutputBytes: MAX_OUTPUT_BYTES,
  processingConcurrency: PROCESSING_CONCURRENCY,
  jobTtlMs: JOB_TTL_MS,
  openRouterTimeoutMs: OPENROUTER_TIMEOUT_MS,
  openRouterModel: OPENROUTER_MODEL
} as const;
