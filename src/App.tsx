import { useEffect, useMemo, useRef, useState } from "react";
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
  const [submittedFormat, setSubmittedFormat] = useState<OutputFormat>();
  const [jobId, setJobId] = useState<string>();
  const [tasks, setTasks] = useState<JobTask[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string>();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pendingRetryTaskId, setPendingRetryTaskId] = useState<string>();
  const [error, setError] = useState<string>();
  const [pollingError, setPollingError] = useState<string>();
  const [canRetryStatus, setCanRetryStatus] = useState(false);
  const [pollVersion, setPollVersion] = useState(0);
  const sessionGeneration = useRef(0);
  const submitController = useRef<AbortController | undefined>(undefined);
  const pollController = useRef<AbortController | undefined>(undefined);
  const retryController = useRef<AbortController | undefined>(undefined);

  const selectedIndex = tasks.findIndex((task) => task.taskId === selectedTaskId);
  const selectedTask = selectedIndex >= 0 ? tasks[selectedIndex] : undefined;
  const selectedFile = selectedIndex >= 0 ? files[selectedIndex] : undefined;
  const selectedOutputUrl = selectedTask?.result?.previewUrl;
  const formatForSession = submittedFormat ?? outputFormat;

  useEffect(() => {
    return () => {
      submitController.current?.abort();
      pollController.current?.abort();
      retryController.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (!jobId) return;
    const generation = sessionGeneration.current;
    const controller = new AbortController();
    pollController.current?.abort();
    pollController.current = controller;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;

    const schedulePoll = (delay: number, attempt: number) => {
      timer = setTimeout(() => void poll(attempt), delay);
    };

    const poll = async (attempt: number) => {
      try {
        const status = await getJob(jobId, controller.signal);
        if (controller.signal.aborted || disposed || sessionGeneration.current !== generation) return;
        setTasks(status.tasks);
        setSelectedTaskId((current) => current ?? status.tasks[0]?.taskId);
        setPollingError(undefined);
        setCanRetryStatus(false);
        if (status.tasks.every((task) => task.status === "complete" || task.status === "failed")) return;
        schedulePoll(1000, 0);
      } catch (pollError) {
        if (controller.signal.aborted || disposed || sessionGeneration.current !== generation) return;
        if (attempt < 3) {
          setPollingError("Status refresh failed. Retrying shortly...");
          schedulePoll(Math.min(100 * 2 ** attempt, 800), attempt + 1);
        } else {
          setPollingError("Status refresh stopped after several attempts.");
          setCanRetryStatus(true);
        }
      }
    };

    void poll(0);
    return () => {
      disposed = true;
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [jobId, pollVersion]);

  const handleFilesSelected = (nextFiles: File[]) => {
    sessionGeneration.current += 1;
    submitController.current?.abort();
    pollController.current?.abort();
    retryController.current?.abort();
    retryController.current = undefined;
    setIsSubmitting(false);
    setFiles(nextFiles);
    setTasks([]);
    setJobId(undefined);
    setSubmittedFormat(undefined);
    setSelectedTaskId(undefined);
    setPendingRetryTaskId(undefined);
    setError(undefined);
    setPollingError(undefined);
    setCanRetryStatus(false);
  };

  const handleSubmit = async () => {
    if (files.length === 0) {
      setError("Select at least one photo before enhancing.");
      return;
    }
    if (isSubmitting) return;
    sessionGeneration.current += 1;
    const generation = sessionGeneration.current;
    submitController.current?.abort();
    pollController.current?.abort();
    retryController.current?.abort();
    retryController.current = undefined;
    setJobId(undefined);
    setTasks([]);
    setSelectedTaskId(undefined);
    setSubmittedFormat(undefined);
    setPendingRetryTaskId(undefined);
    setError(undefined);
    setPollingError(undefined);
    setCanRetryStatus(false);
    setIsSubmitting(true);
    const controller = new AbortController();
    submitController.current = controller;
    const format = outputFormat;
    setSubmittedFormat(format);
    try {
      const summary = await createJob(files, preset, controls, format, controller.signal);
      if (controller.signal.aborted || sessionGeneration.current !== generation) return;
      setJobId(summary.jobId);
      setTasks(summary.tasks);
      setSelectedTaskId(summary.tasks[0]?.taskId);
    } catch (submitError) {
      if (!controller.signal.aborted && sessionGeneration.current === generation) {
        setSubmittedFormat(undefined);
        setError(getErrorMessage(submitError));
      }
    } finally {
      if (sessionGeneration.current === generation && submitController.current === controller) {
        setIsSubmitting(false);
      }
    }
  };

  const handleRetry = async (taskId: string) => {
    if (!jobId || pendingRetryTaskId) return;
    const generation = sessionGeneration.current;
    const controller = new AbortController();
    retryController.current?.abort();
    retryController.current = controller;
    setPendingRetryTaskId(taskId);
    setError(undefined);
    try {
      await retryTask(jobId, taskId, controller.signal);
      if (controller.signal.aborted || sessionGeneration.current !== generation) return;
      setTasks((current) => current.map((task) => task.taskId === taskId ? { ...task, status: "queued", error: undefined } : task));
      setSelectedTaskId(taskId);
      setPollingError(undefined);
      setCanRetryStatus(false);
      setPollVersion((current) => current + 1);
    } catch (retryError) {
      if (!controller.signal.aborted && sessionGeneration.current === generation) setError(getErrorMessage(retryError));
    } finally {
      if (sessionGeneration.current === generation && retryController.current === controller) {
        retryController.current = undefined;
        setPendingRetryTaskId(undefined);
      }
    }
  };

  const retryStatus = () => {
    setPollingError(undefined);
    setCanRetryStatus(false);
    setPollVersion((current) => current + 1);
  };

  const downloadHref = useMemo(() => {
    if (!jobId || !selectedTask || selectedTask.status !== "complete") return undefined;
    return getDownloadUrl(jobId, selectedTask.taskId, formatForSession);
  }, [formatForSession, jobId, selectedTask]);

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
        {(error || pollingError) && (
          <div className="error-message" role="alert">
            <span>{error ?? pollingError}</span>
            {canRetryStatus && <button className="text-button" type="button" onClick={retryStatus}>Retry status</button>}
          </div>
        )}
        <div className="workbench-grid">
          <FileQueue files={files} tasks={tasks} selectedTaskId={selectedTaskId} onSelect={setSelectedTaskId} onRetry={handleRetry} pendingRetryTaskId={pendingRetryTaskId} jobId={jobId} />
          <ImagePreview sourceFile={selectedFile} previewUrl={selectedOutputUrl} taskStatus={selectedTask?.status} taskError={selectedTask?.error} />
          <div className="controls-column">
            <PresetControls preset={preset} controls={controls} outputFormat={formatForSession} formatDisabled={Boolean(submittedFormat)} disabled={isSubmitting} onPresetChange={setPreset} onControlsChange={setControls} onOutputFormatChange={setOutputFormat} onSubmit={handleSubmit} />
            <DownloadActions jobId={jobId} taskId={selectedTask?.taskId} format={formatForSession} href={downloadHref} />
          </div>
        </div>
      </div>
    </main>
  );
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong. Please try again.";
}
