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

export interface UploadConfig {
  maxFileBytes: number;
  maxPixels: number;
  maxBatchSize: number;
  supportedMimeTypes: string[];
}

export interface JobTask {
  taskId: string;
  status: TaskStatus;
  controls?: ManualControls;
  error?: string;
  result?: {
    format: OutputFormat;
    size: number;
    previewUrl: string;
  };
}

export interface JobSummary {
  jobId: string;
  tasks: Array<Pick<JobTask, "taskId" | "status" | "controls">>;
}

export interface JobStatus {
  jobId: string;
  preset: Preset;
  controls: ManualControls;
  createdAt: number;
  expiresAt: number;
  tasks: JobTask[];
}
