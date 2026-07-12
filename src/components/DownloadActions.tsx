import type { OutputFormat } from "../types";

interface DownloadActionsProps {
  jobId?: string;
  taskId?: string;
  format: OutputFormat;
  href?: string;
}

export function DownloadActions({ jobId, taskId, format, href }: DownloadActionsProps) {
  if (!href || !jobId || !taskId) return null;
  return (
    <div className="download-actions">
      <a className="secondary-button" href={href} download={`photo-enhanced.${format}`}>
        Download {format.toUpperCase()}
      </a>
    </div>
  );
}
