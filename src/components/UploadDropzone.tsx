import type { ChangeEvent, DragEvent, KeyboardEvent } from "react";

interface UploadDropzoneProps {
  files: File[];
  onFilesSelected: (files: File[]) => void;
}

export function UploadDropzone({ files, onFilesSelected }: UploadDropzoneProps) {
  const handleFiles = (fileList: FileList | null) => {
    if (fileList) onFilesSelected(Array.from(fileList));
  };
  const handleChange = (event: ChangeEvent<HTMLInputElement>) => handleFiles(event.target.files);
  const handleDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    handleFiles(event.dataTransfer.files);
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
    </label>
  );
}
