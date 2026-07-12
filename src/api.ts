import type {
  JobStatus,
  JobSummary,
  ManualControls,
  OutputFormat,
  Preset
} from "./types";

export type { JobStatus, JobSummary } from "./types";

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? "The request could not be completed.");
  }
  return response.json() as Promise<T>;
}

export async function createJob(
  files: File[],
  preset: Preset,
  controls: ManualControls,
  outputFormat: OutputFormat,
  signal?: AbortSignal
): Promise<JobSummary> {
  const body = new FormData();
  files.forEach((file) => body.append("files", file));
  body.append("preset", preset);
  body.append("controls", JSON.stringify(controls));
  body.append("outputFormat", outputFormat);

  return readJson<JobSummary>(
    await fetch("/api/jobs", { method: "POST", body, signal })
  );
}

export async function getJob(jobId: string, signal?: AbortSignal): Promise<JobStatus> {
  return readJson<JobStatus>(await fetch(`/api/jobs/${encodeURIComponent(jobId)}`, { signal }));
}

export async function retryTask(
  jobId: string,
  taskId: string,
  signal?: AbortSignal
): Promise<void> {
  await readJson(await fetch(
    `/api/jobs/${encodeURIComponent(jobId)}/tasks/${encodeURIComponent(taskId)}/retry`,
    { method: "POST", signal }
  ));
}

export function getDownloadUrl(jobId: string, taskId: string, format: OutputFormat): string {
  return `/api/jobs/${encodeURIComponent(jobId)}/tasks/${encodeURIComponent(taskId)}/download?format=${format}`;
}
