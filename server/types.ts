export type Preset = "auto" | "upscale" | "custom";
export type UpscaleMode = "ai" | "classic";

export interface ManualControls {
  strength: number;
  sharpness: number;
  noiseReduction: number;
  brightness: number;
  contrast: number;
}

export interface EnhancementParameters {
  scale: number;
  sharpen: number;
  denoise: number;
  brightness: number;
  contrast: number;
}

export type SupportedImageFormat = "jpeg" | "png" | "webp" | "avif";
export type OutputFormat = "jpg" | "png";

export interface ImageMetadata {
  format: SupportedImageFormat;
  width: number;
  height: number;
  size: number;
  channels?: number;
  hasAlpha?: boolean;
}

export type TaskStatus =
  | "queued"
  | "analyzing"
  | "processing"
  | "complete"
  | "failed";

export interface StoredUpload {
  id: string;
  originalPath: string;
  metadata: ImageMetadata;
}

export interface ImageTask {
  id: string;
  originalPath: string;
  metadata: ImageMetadata;
  status: TaskStatus;
  outputPath?: string;
  outputFormat?: OutputFormat;
  controls?: ManualControls;
  prompt?: string;
  error?: string;
}

export interface Job {
  id: string;
  preset: Preset;
  controls: ManualControls;
  upscaleMode: UpscaleMode;
  apiKey?: string;
  prompt?: string;
  tasks: ImageTask[];
  createdAt: number;
  expiresAt: number;
}

export type TaskUpdate = Partial<
  Pick<ImageTask, "status" | "outputPath" | "outputFormat" | "error">
>;
