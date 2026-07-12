import type {
  JobStatus,
  JobSummary,
  ManualControls,
  OutputFormat,
  Preset,
  UploadConfig,
  UpscaleMode
} from "./types";

export type { JobStatus, JobSummary } from "./types";

export class ApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    throw await responseError(response);
  }
  return response.json() as Promise<T>;
}

async function responseError(response: Response): Promise<ApiError> {
  const body = (await response.json().catch(() => null)) as { error?: string } | null;
  return new ApiError(
    response.status,
    body?.error ?? "The request could not be completed."
  );
}

export async function getUploadConfig(): Promise<UploadConfig> {
  return readJson<UploadConfig>(await fetch("/api/config"));
}

export async function createJob(
  files: File[],
  preset: Preset,
  controls: ManualControls,
  outputFormat: OutputFormat,
  signal?: AbortSignal,
  controlsByTask?: ManualControls[],
  onProgress?: (percentage: number) => void,
  upscaleMode?: UpscaleMode
): Promise<JobSummary> {
  const body = new FormData();
  files.forEach((file) => body.append("files", file));
  body.append("preset", preset);
  body.append("controls", JSON.stringify(controls));
  body.append("outputFormat", outputFormat);
  if (controlsByTask) body.append("controlsByTask", JSON.stringify(controlsByTask));
  if (upscaleMode) body.append("upscaleMode", upscaleMode);

  return new Promise<JobSummary>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/jobs");
    xhr.responseType = "json";
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onload = () => {
      const result = xhr.response as { error?: string } | JobSummary | null;
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(result as JobSummary);
      } else {
        reject(new ApiError(xhr.status, result && "error" in result ? result.error ?? "The request could not be completed." : "The request could not be completed."));
      }
    };
    xhr.onerror = () => reject(new Error("The request could not be completed."));
    xhr.onabort = () => reject(new DOMException("The request was aborted", "AbortError"));
    if (signal) {
      if (signal.aborted) {
        xhr.abort();
        return;
      }
      signal.addEventListener("abort", () => xhr.abort(), { once: true });
    }
    xhr.send(body);
  });
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

export async function downloadResult(
  jobId: string,
  taskId: string,
  format: OutputFormat,
  signal?: AbortSignal
): Promise<void> {
  const response = await fetch(getDownloadUrl(jobId, taskId, format), { signal });
  if (!response.ok) throw await responseError(response);
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.startsWith("image/")) {
    throw new ApiError(response.status, "The downloaded result was not an image.");
  }
  const blob = await response.blob();
  if (blob.size === 0) throw new ApiError(response.status, "The downloaded result was empty.");
  const objectUrl = URL.createObjectURL(blob);
  try {
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = `photo-enhanced.${format}`;
    link.click();
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
