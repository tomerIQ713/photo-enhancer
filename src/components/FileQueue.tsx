import { useEffect, useState } from "react";
import type { JobTask } from "../types";

interface FileQueueProps {
  files: File[];
  tasks: JobTask[];
  selectedIndex: number;
  onSelect: (index: number) => void;
  onRetry: (taskId: string) => void;
  pendingRetryTaskId?: string;
}

const statusLabels: Record<JobTask["status"], string> = {
  queued: "Queued",
  analyzing: "Analyzing",
  processing: "Enhancing",
  complete: "Complete",
  failed: "Failed"
};

export function FileQueue({ files, tasks, selectedIndex, onSelect, onRetry, pendingRetryTaskId }: FileQueueProps) {
  return (
    <section className="panel queue-panel" aria-labelledby="queue-heading">
      <div className="panel-heading">
        <div>
          <p className="section-kicker">Temporary session</p>
          <h2 id="queue-heading">Your queue</h2>
        </div>
        <span className="count-badge">{files.length}</span>
      </div>
      {files.length === 0 ? (
        <p className="empty-copy">Add one or more photos to start a temporary session.</p>
      ) : (
        <ul className="file-list">
          {files.map((file, index) => {
            const task = tasks[index];
            const isSelected = index === selectedIndex;
            return (
              <li key={`${file.name}-${index}`}>
                <button
                  className={`file-row ${isSelected ? "is-selected" : ""}`}
                  type="button"
                   onClick={() => onSelect(index)}
                  aria-pressed={isSelected}
                >
                  <span className="file-index">{String(index + 1).padStart(2, "0")}</span>
                  <span className="file-details">
                    <QueueThumbnail file={file} />
                    <strong>{file.name}</strong>
                    <small>{formatBytes(file.size)}</small>
                  </span>
                  {task && <span className={`status status-${task.status}`}>
                    {statusLabels[task.status]}
                    {task.status === "failed" && task.error ? `: ${task.error}` : ""}
                  </span>}
                </button>
                {task?.status === "failed" && (
                    <button
                      className="text-button retry-button"
                      type="button"
                      onClick={() => onRetry(task.taskId)}
                      disabled={pendingRetryTaskId === task.taskId}
                      aria-label={`Retry ${file.name}`}
                    >
                    {pendingRetryTaskId === task.taskId ? "Retrying..." : "Retry"}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function QueueThumbnail({ file }: { file: File }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    if (typeof URL.createObjectURL === "function") {
      const objectUrl = URL.createObjectURL(file);
      setUrl(objectUrl);
      return () => {
        if (typeof URL.revokeObjectURL === "function") URL.revokeObjectURL(objectUrl);
      };
    }
    const reader = new FileReader();
    reader.onload = () => setUrl(typeof reader.result === "string" ? reader.result : "");
    reader.readAsDataURL(file);
    return () => { reader.onload = null; };
  }, [file]);
  return url ? <img className="queue-thumbnail" src={url} alt={`Queue thumbnail ${file.name}`} /> : null;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
