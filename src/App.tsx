import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createJob, getDownloadUrl, getJob, retryTask } from "./api";
import type { JobTask, ManualControls, OutputFormat, Preset } from "./types";
import { DownloadActions } from "./components/DownloadActions";
import { FileQueue } from "./components/FileQueue";
import { ImagePreview } from "./components/ImagePreview";
import { PresetControls } from "./components/PresetControls";
import { UploadDropzone } from "./components/UploadDropzone";
import "./styles.css";

const DEFAULT_CONTROLS: ManualControls = {
  strength: 50,
  sharpness: 50,
  noiseReduction: 50,
  brightness: 50,
  contrast: 50
};

export function App() {
  const [files, setFiles] = useState<File[]>([]);
  const [preset, setPreset] = useState<Preset>("auto");
  const [controls, setControls] = useState<ManualControls>(DEFAULT_CONTROLS);
  const [outputFormat, setOutputFormat] = useState<OutputFormat>("png");
  const [jobId, setJobId] = useState<string>();
  const [tasks, setTasks] = useState<JobTask[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string>();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  const [pollVersion, setPollVersion] = useState(0);
  const requestController = useRef<AbortController | undefined>(undefined);

  const selectedIndex = tasks.findIndex((task) => task.taskId === selectedTaskId);
  const selectedTask = selectedIndex >= 0 ? tasks[selectedIndex] : undefined;
  const selectedFileUrl = useMemo(() => {
    if (selectedIndex < 0 || typeof URL.createObjectURL !== "function") return undefined;
    return URL.createObjectURL(files[selectedIndex]);
  }, [files, selectedIndex]);
  useEffect(() => {
    return () => {
      if (selectedFileUrl) URL.revokeObjectURL(selectedFileUrl);
    };
  }, [selectedFileUrl]);
  const selectedOriginalUrl = selectedTask?.originalUrl ?? selectedFileUrl;
  const selectedOutputUrl = selectedTask?.outputUrl ?? (jobId && selectedTask?.status === "complete" && selectedTask
    ? getDownloadUrl(jobId, selectedTask.taskId, outputFormat)
    : undefined);

  useEffect(() => {
    return () => requestController.current?.abort();
  }, []);

  useEffect(() => {
    if (!jobId) return;
    const controller = new AbortController();
    requestController.current = controller;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      try {
        const status = await getJob(jobId, controller.signal);
        if (controller.signal.aborted) return;
        setTasks(status.tasks);
        setSelectedTaskId((current) => current ?? status.tasks[0]?.taskId);
        if (status.tasks.every((task) => task.status === "complete" || task.status === "failed")) return;
        timer = setTimeout(poll, 1000);
      } catch (pollError) {
        if (!controller.signal.aborted) setError(getErrorMessage(pollError));
      }
    };

    void poll();
    return () => {
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [jobId, pollVersion]);

  const handleFilesSelected = (nextFiles: File[]) => {
    requestController.current?.abort();
    setFiles(nextFiles);
    setTasks([]);
    setJobId(undefined);
    setSelectedTaskId(undefined);
    setError(undefined);
  };

  const handleSubmit = async () => {
    if (files.length === 0) {
      setError("Select at least one photo before enhancing.");
      return;
    }
    setError(undefined);
    setIsSubmitting(true);
    const controller = new AbortController();
    requestController.current = controller;
    try {
      const summary = await createJob(files, preset, controls, outputFormat);
      setJobId(summary.jobId);
      setTasks(summary.tasks);
      setSelectedTaskId(summary.tasks[0]?.taskId);
    } catch (submitError) {
      if (!controller.signal.aborted) setError(getErrorMessage(submitError));
    } finally {
      if (!controller.signal.aborted) setIsSubmitting(false);
    }
  };

  const handleRetry = async (taskId: string) => {
    if (!jobId) return;
    setError(undefined);
    try {
      await retryTask(jobId, taskId);
      setTasks((current) => current.map((task) => task.taskId === taskId ? { ...task, status: "queued", error: undefined } : task));
      setSelectedTaskId(taskId);
      setPollVersion((current) => current + 1);
    } catch (retryError) {
      setError(getErrorMessage(retryError));
    }
  };

  const downloadHref = useMemo(() => {
    if (!jobId || !selectedTask || selectedTask.status !== "complete") return undefined;
    return getDownloadUrl(jobId, selectedTask.taskId, outputFormat);
  }, [jobId, outputFormat, selectedTask]);

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Photo Enhancer home"><span className="brand-mark">PE</span> Photo Enhancer</a>
        <span className="session-note">No account needed · files expire automatically</span>
      </header>
      <div className="content-wrap">
        <section className="intro">
          <p className="section-kicker">Simple image enhancement</p>
          <h1>Make good photos feel finished.</h1>
          <p>Upload a small batch, choose a finish, and review every result before downloading.</p>
        </section>
        <UploadDropzone files={files} onFilesSelected={handleFilesSelected} />
        {error && <p className="error-message" role="alert">{error}</p>}
        <div className="workbench-grid">
          <FileQueue files={files} tasks={tasks} selectedTaskId={selectedTaskId} onSelect={setSelectedTaskId} onRetry={handleRetry} jobId={jobId} />
          <ImagePreview originalUrl={selectedOriginalUrl} outputUrl={selectedOutputUrl} taskStatus={selectedTask?.status} />
          <div className="controls-column">
            <PresetControls preset={preset} controls={controls} outputFormat={outputFormat} disabled={isSubmitting} onPresetChange={setPreset} onControlsChange={setControls} onOutputFormatChange={setOutputFormat} onSubmit={handleSubmit} />
            <DownloadActions jobId={jobId} taskId={selectedTask?.taskId} format={outputFormat} href={downloadHref} />
          </div>
        </div>
      </div>
    </main>
  );
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong. Please try again.";
}
