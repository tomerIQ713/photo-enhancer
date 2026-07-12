export type Preset = "auto" | "upscale";
export type OutputFormat = "jpg" | "png";

export interface ManualControls {
  strength: number;
  sharpness: number;
  noiseReduction: number;
  brightness: number;
  contrast: number;
}

export type TaskStatus = "queued" | "analyzing" | "processing" | "complete" | "failed";

export interface JobTask {
  taskId: string;
  status: TaskStatus;
  error?: string;
  originalUrl?: string;
  outputUrl?: string;
}

export interface JobSummary {
  jobId: string;
  tasks: Array<Pick<JobTask, "taskId" | "status">>;
}

export interface JobStatus {
  jobId: string;
  preset: Preset;
  controls: ManualControls;
  createdAt: number;
  expiresAt: number;
  tasks: JobTask[];
}
