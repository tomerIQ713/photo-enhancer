import { useEffect, useRef, type ChangeEvent, type DragEvent, type KeyboardEvent } from "react";
import type { UploadConfig } from "../types";

interface UploadDropzoneProps {
  files: File[];
  onFilesSelected: (files: File[]) => void;
  onValidationError: (message: string) => void;
  config: UploadConfig;
}

export function UploadDropzone({ files, onFilesSelected, onValidationError, config }: UploadDropzoneProps) {
  const validationGeneration = useRef(0);
  const validationAbort = useRef<AbortController | undefined>(undefined);

  useEffect(() => () => validationAbort.current?.abort(), []);

  const handleFiles = async (fileList: FileList | null) => {
    if (!fileList) return;
    validationAbort.current?.abort();
    const controller = new AbortController();
    validationAbort.current = controller;
    const generation = validationGeneration.current + 1;
    validationGeneration.current = generation;
    const isCurrent = () => !controller.signal.aborted && validationGeneration.current === generation;
    const nextFiles = Array.from(fileList);
    if (nextFiles.length === 0 || nextFiles.length > config.maxBatchSize) {
      onValidationError(`Choose between 1 and ${config.maxBatchSize} photos.`);
      return;
    }
    const invalidType = nextFiles.find((file) => !config.supportedMimeTypes.includes(file.type));
    if (invalidType) {
      onValidationError(`Unsupported format. Supported formats are ${formatSupportedTypes(config.supportedMimeTypes)}.`);
      return;
    }
    const oversized = nextFiles.find((file) => file.size > config.maxFileBytes);
    if (oversized) {
      onValidationError(`File too large. Each photo must be ${formatBytes(config.maxFileBytes)} or smaller.`);
      return;
    }
    if (typeof createImageBitmap === "function") {
      for (const file of nextFiles) {
        try {
          const bitmap = await createImageBitmap(file);
          if (!isCurrent()) {
            bitmap.close();
            return;
          }
          const pixels = bitmap.width * bitmap.height;
          bitmap.close();
          if (!isCurrent()) return;
           if (pixels > config.maxPixels) {
             onValidationError(`Image exceeds the ${config.maxPixels.toLocaleString("en-US")} pixel limit.`);
            return;
          }
        } catch {
          if (!isCurrent()) return;
          // The server remains the source of truth for image decoding.
        }
      }
    }
    if (!isCurrent()) return;
    onFilesSelected(nextFiles);
  };
  const handleChange = (event: ChangeEvent<HTMLInputElement>) => void handleFiles(event.target.files);
  const handleDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    void handleFiles(event.dataTransfer.files);
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLLabelElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      event.currentTarget.querySelector<HTMLInputElement>("input")?.click();
    }
  };

  return (
    <label
      className="dropzone"
      htmlFor="photo-upload"
      tabIndex={0}
      onDragOver={(event) => event.preventDefault()}
      onDrop={handleDrop}
      onKeyDown={handleKeyDown}
    >
      <input
        id="photo-upload"
        type="file"
        accept={config.supportedMimeTypes.join(",")}
        multiple
        onChange={handleChange}
      />
      <span className="dropzone-title">Upload photos</span>
      <span className="dropzone-help">
        {files.length > 0
          ? `${files.length} photo${files.length === 1 ? "" : "s"} selected`
          : "Drop images here or press Enter to browse"}
      </span>
      <span className="dropzone-guidance">{formatSupportedTypes(config.supportedMimeTypes)} · up to {formatBytes(config.maxFileBytes)} · {formatPixels(config.maxPixels)}</span>
    </label>
  );
}

function formatBytes(bytes: number): string {
  const megabytes = bytes / (1024 * 1024);
  if (Number.isInteger(megabytes)) return `${megabytes} MB`;
  const kilobytes = bytes / 1024;
  if (Number.isInteger(kilobytes)) return `${kilobytes} KB`;
  return `${bytes} bytes`;
}

function formatPixels(pixels: number): string {
  if (pixels % 1_000_000 === 0) return `${pixels / 1_000_000} million pixels`;
  return `${pixels.toLocaleString("en-US")} pixels`;
}

function formatSupportedTypes(types: string[]): string {
  const labels: Record<string, string> = {
    "image/jpeg": "JPEG",
    "image/png": "PNG",
    "image/webp": "WebP",
    "image/avif": "AVIF"
  };
  const names = types.map((type) => labels[type] ?? type).filter(Boolean);
  if (names.length <= 1) return names[0] ?? "Supported image formats";
  if (names.length === 2) return `${names[0]} or ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, or ${names[names.length - 1]}`;
}
