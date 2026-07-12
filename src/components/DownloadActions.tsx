import type { OutputFormat } from "../types";

interface DownloadActionsProps {
  jobId?: string;
  taskId?: string;
  format: OutputFormat;
  href?: string;
  batch?: Array<{ href: string; format: OutputFormat }>;
}

export function DownloadActions({ jobId, taskId, format, href, batch = [] }: DownloadActionsProps) {
  if ((!href || !jobId || !taskId) && !(jobId && batch.length > 1)) return null;
  const downloadAll = async () => {
    for (const item of batch) {
      const link = document.createElement("a");
      link.href = item.href;
      link.download = `photo-enhanced.${item.format}`;
      link.click();
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  };
  return (
    <div className="download-actions">
      {href && jobId && taskId && <a className="secondary-button" href={href} download={`photo-enhanced.${format}`}>
        Download {format.toUpperCase()}
      </a>}
      {batch.length > 1 && <button className="secondary-button" type="button" onClick={() => void downloadAll()}>
        Download all {batch.length} {format.toUpperCase()}s (one at a time)
      </button>}
    </div>
  );
}
