import type { JobTask } from "../types";

interface FileQueueProps {
  files: File[];
  tasks: JobTask[];
  selectedTaskId?: string;
  onSelect: (taskId: string) => void;
  onRetry: (taskId: string) => void;
  jobId?: string;
}

const statusLabels: Record<JobTask["status"], string> = {
  queued: "Queued",
  analyzing: "Analyzing",
  processing: "Enhancing",
  complete: "Complete",
  failed: "Failed"
};

export function FileQueue({ files, tasks, selectedTaskId, onSelect, onRetry }: FileQueueProps) {
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
            const isSelected = task?.taskId === selectedTaskId;
            return (
              <li key={`${file.name}-${index}`}>
                <button
                  className={`file-row ${isSelected ? "is-selected" : ""}`}
                  type="button"
                  onClick={() => task && onSelect(task.taskId)}
                  disabled={!task}
                  aria-pressed={isSelected}
                >
                  <span className="file-index">{String(index + 1).padStart(2, "0")}</span>
                  <span className="file-details">
                    <strong>{file.name}</strong>
                    <small>{formatBytes(file.size)}</small>
                  </span>
                  {task && <span className={`status status-${task.status}`}>{statusLabels[task.status]}</span>}
                </button>
                {task?.status === "failed" && (
                  <button className="text-button retry-button" type="button" onClick={() => onRetry(task.taskId)}>
                    Retry
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

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
