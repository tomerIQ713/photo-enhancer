import { useEffect, useRef, type ChangeEvent, type DragEvent, type KeyboardEvent } from "react";

interface UploadDropzoneProps {
  files: File[];
  onFilesSelected: (files: File[]) => void;
  onValidationError: (message: string) => void;
}

const MAX_FILES = 5;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const SUPPORTED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/avif"]);

export function UploadDropzone({ files, onFilesSelected, onValidationError }: UploadDropzoneProps) {
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
    if (nextFiles.length === 0 || nextFiles.length > MAX_FILES) {
      onValidationError("Choose between 1 and 5 photos.");
      return;
    }
    const invalidType = nextFiles.find((file) => !SUPPORTED_TYPES.has(file.type));
    if (invalidType) {
      onValidationError("Unsupported format. Supported formats are JPEG, PNG, WebP, and AVIF.");
      return;
    }
    const oversized = nextFiles.find((file) => file.size > MAX_FILE_BYTES);
    if (oversized) {
      onValidationError("File too large. Each photo must be 10 MB or smaller.");
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
          if (pixels > 25_000_000) {
            onValidationError("Image exceeds the 25 million pixel limit.");
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
        accept="image/jpeg,image/png,image/webp,image/avif"
        multiple
        onChange={handleChange}
      />
      <span className="dropzone-title">Upload photos</span>
      <span className="dropzone-help">
        {files.length > 0
          ? `${files.length} photo${files.length === 1 ? "" : "s"} selected`
          : "Drop images here or press Enter to browse"}
      </span>
      <span className="dropzone-guidance">JPEG, PNG, WebP, or AVIF · up to 10 MB · 25 million pixels</span>
    </label>
  );
}
