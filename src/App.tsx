import { useEffect, useMemo, useRef, useState } from "react";
import { createJob, downloadResult, getDownloadUrl, getJob, getUploadConfig, retryTask } from "./api";
import type { JobTask, ManualControls, OutputFormat, Preset, UploadConfig, UpscaleMode } from "./types";
import { DownloadActions } from "./components/DownloadActions";
import { FileQueue } from "./components/FileQueue";
import { ImagePreview } from "./components/ImagePreview";
import { PresetControls } from "./components/PresetControls";
import { SettingsModal, getStoredApiKey } from "./components/SettingsModal";
import { UploadDropzone } from "./components/UploadDropzone";
import "./styles.css";

const DEFAULT_CONTROLS: ManualControls = {
  strength: 50,
  sharpness: 50,
  noiseReduction: 50,
  brightness: 50,
  contrast: 50
};

const PRESET_DEFAULTS: Record<Preset, ManualControls> = {
  auto: DEFAULT_CONTROLS,
  upscale: { strength: 70, sharpness: 70, noiseReduction: 35, brightness: 50, contrast: 55 }
};

const DEFAULT_UPLOAD_CONFIG: UploadConfig = {
  maxFileBytes: 10 * 1024 * 1024,
  maxPixels: 25_000_000,
  maxBatchSize: 5,
  supportedMimeTypes: ["image/jpeg", "image/png", "image/webp", "image/avif"]
};

export function App() {
  const [files, setFiles] = useState<File[]>([]);
  const [preset, setPreset] = useState<Preset>("auto");
  const [upscaleMode, setUpscaleMode] = useState<UpscaleMode>("ai");
  const [controls, setControls] = useState<ManualControls>(DEFAULT_CONTROLS);
  const [controlsByFile, setControlsByFile] = useState<ManualControls[]>([]);
  const [outputFormat, setOutputFormat] = useState<OutputFormat>("png");
  const [submittedFormat, setSubmittedFormat] = useState<OutputFormat>();
  const [jobId, setJobId] = useState<string>();
  const [tasks, setTasks] = useState<JobTask[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string>();
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pendingRetryTaskId, setPendingRetryTaskId] = useState<string>();
  const [error, setError] = useState<string>();
  const [pollingError, setPollingError] = useState<string>();
  const [canRetryStatus, setCanRetryStatus] = useState(false);
  const [resultUnavailable, setResultUnavailable] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number>();
  const [uploadConfig, setUploadConfig] = useState<UploadConfig>(DEFAULT_UPLOAD_CONFIG);
  const [pollVersion, setPollVersion] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [apiKey, setApiKey] = useState(() => getStoredApiKey());
  const sessionGeneration = useRef(0);
  const submitController = useRef<AbortController | undefined>(undefined);
  const pollController = useRef<AbortController | undefined>(undefined);
  const retryController = useRef<AbortController | undefined>(undefined);

  const selectedTask = selectedIndex >= 0 ? tasks[selectedIndex] : undefined;
  const selectedFile = selectedIndex >= 0 ? files[selectedIndex] : undefined;
  const selectedOutputUrl = selectedTask?.result?.previewUrl;
  const selectedControls = controlsByFile[selectedIndex] ?? controls;
  const formatForSession = submittedFormat ?? outputFormat;

  useEffect(() => {
    return () => {
      submitController.current?.abort();
      pollController.current?.abort();
      retryController.current?.abort();
    };
  }, []);

  useEffect(() => {
    let active = true;
    void getUploadConfig()
      .then((config) => {
        if (active && !sameUploadConfig(config, DEFAULT_UPLOAD_CONFIG)) setUploadConfig(config);
      })
      .catch(() => undefined);
    return () => {
      active = false;
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
        setResultUnavailable(false);
        setSelectedTaskId((current) => current ?? status.tasks[0]?.taskId);
        setSelectedIndex((current) => Math.min(current, Math.max(0, status.tasks.length - 1)));
        setPollingError(undefined);
        setCanRetryStatus(false);
        if (status.tasks.every((task) => task.status === "complete" || task.status === "failed")) return;
        schedulePoll(1000, 0);
      } catch (pollError) {
        if (controller.signal.aborted || disposed || sessionGeneration.current !== generation) return;
        if (isExpiredError(pollError)) {
          handleResultUnavailable();
          return;
        }
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
    const nextPresetControls = { ...PRESET_DEFAULTS[preset] };
    setControlsByFile(nextFiles.map(() => ({ ...nextPresetControls })));
    setControls(nextPresetControls);
    setTasks([]);
    setJobId(undefined);
    setSubmittedFormat(undefined);
    setSelectedTaskId(undefined);
    setPendingRetryTaskId(undefined);
    setError(undefined);
    setPollingError(undefined);
    setCanRetryStatus(false);
    setResultUnavailable(false);
    setUploadProgress(undefined);
  };

  const handleValidationError = (message: string) => {
    setError(message);
  };

  const handleSelect = (index: number) => {
    setSelectedIndex(index);
    setSelectedTaskId(tasks[index]?.taskId);
    setControls(controlsByFile[index] ?? DEFAULT_CONTROLS);
  };

  const handleControlsChange = (nextControls: ManualControls) => {
    setControls(nextControls);
    setControlsByFile((current) => current.map((item, index) => index === selectedIndex ? nextControls : item));
  };

  const resetControls = () => handleControlsChange({ ...PRESET_DEFAULTS[preset] });

  const handlePresetChange = (nextPreset: Preset) => {
    setPreset(nextPreset);
    const nextControls = { ...PRESET_DEFAULTS[nextPreset] };
    setControls(nextControls);
    setControlsByFile((current) => current.map(() => ({ ...nextControls })));
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
    setSelectedIndex(0);
    setSubmittedFormat(undefined);
    setPendingRetryTaskId(undefined);
    setError(undefined);
    setPollingError(undefined);
    setCanRetryStatus(false);
    setResultUnavailable(false);
    setIsSubmitting(true);
    setUploadProgress(0);
    const controller = new AbortController();
    submitController.current = controller;
    const format = outputFormat;
    setSubmittedFormat(format);
    try {
      const summary = await createJob(
        files,
        preset,
        controlsByFile[0] ?? controls,
        format,
        controller.signal,
        controlsByFile,
        setUploadProgress,
        preset === "upscale" ? upscaleMode : undefined,
        apiKey || undefined
      );
      if (controller.signal.aborted || sessionGeneration.current !== generation) return;
      setJobId(summary.jobId);
      setTasks(summary.tasks);
      setSelectedTaskId(summary.tasks[0]?.taskId);
      setSelectedIndex(0);
      setUploadProgress(undefined);
    } catch (submitError) {
      if (!controller.signal.aborted && sessionGeneration.current === generation) {
        setSubmittedFormat(undefined);
        setError(getErrorMessage(submitError));
        setUploadProgress(undefined);
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
       setSelectedIndex(tasks.findIndex((task) => task.taskId === taskId));
      setPollingError(undefined);
      setCanRetryStatus(false);
      setPollVersion((current) => current + 1);
    } catch (retryError) {
      if (!controller.signal.aborted && sessionGeneration.current === generation) {
        if (isExpiredError(retryError)) {
          handleResultUnavailable();
        } else {
          setError(getErrorMessage(retryError));
        }
      }
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

  const handleResultUnavailable = () => {
    setResultUnavailable(true);
    setError(undefined);
    setPollingError(undefined);
    setCanRetryStatus(false);
  };

  const handleDownload = async (taskId: string, format: OutputFormat) => {
    try {
      await downloadResult(jobId!, taskId, format);
    } catch (downloadError) {
      if (isExpiredError(downloadError)) {
        handleResultUnavailable();
      } else {
        setError(getErrorMessage(downloadError));
      }
    }
  };

  const handleDownloadAll = async () => {
    for (const item of batchDownloads) {
      try {
        await downloadResult(jobId!, item.taskId, item.format);
      } catch (downloadError) {
        if (isExpiredError(downloadError)) handleResultUnavailable();
        else setError(getErrorMessage(downloadError));
        return;
      }
    }
  };

  const downloadHref = useMemo(() => {
    if (resultUnavailable || !jobId || !selectedTask || selectedTask.status !== "complete" || !selectedTask.result?.previewUrl) return undefined;
    return getDownloadUrl(jobId, selectedTask.taskId, formatForSession);
  }, [formatForSession, jobId, resultUnavailable, selectedTask]);

  const batchDownloads = useMemo(() => {
    if (!jobId || resultUnavailable) return [];
    return tasks
        .filter((task) => task.status === "complete" && task.result?.previewUrl)
        .map((task) => ({
          href: getDownloadUrl(jobId, task.taskId, formatForSession),
          taskId: task.taskId,
          format: formatForSession
      }));
  }, [formatForSession, jobId, resultUnavailable, tasks]);

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Photo Enhancer home"><span className="brand-mark">PE</span> Photo Enhancer</a>
        <span className="session-note">No account needed · files expire automatically</span>
        <button className="text-button settings-button" type="button" onClick={() => setSettingsOpen(true)} aria-label="Open settings">
          <span className="settings-icon">⚙</span>
          <span className="settings-label">Settings</span>
        </button>
      </header>
      <div className="content-wrap">
        <section className="intro">
          <p className="section-kicker">Simple image enhancement</p>
          <h1>Make good photos feel finished.</h1>
          <p>Upload a small batch, choose a finish, and review every result before downloading.</p>
        </section>
        <UploadDropzone files={files} config={uploadConfig} onFilesSelected={handleFilesSelected} onValidationError={handleValidationError} />
        {uploadProgress !== undefined && <p className="upload-progress" role="status">Uploading photos: {uploadProgress}%</p>}
        {(error || pollingError) && (
          <div className="error-message" role="alert">
            <span>{error ?? pollingError}</span>
            {canRetryStatus && <button className="text-button" type="button" onClick={retryStatus}>Retry status</button>}
          </div>
        )}
        <div className="workbench-grid">
          <FileQueue files={files} tasks={tasks} selectedIndex={selectedIndex} onSelect={handleSelect} onRetry={handleRetry} pendingRetryTaskId={pendingRetryTaskId} />
          <ImagePreview sourceFile={selectedFile} previewUrl={selectedOutputUrl} taskStatus={selectedTask?.status} taskError={selectedTask?.error} resultUnavailable={resultUnavailable} onResultUnavailable={handleResultUnavailable} onEnhanceAnother={() => handleFilesSelected([])} />
          <div className="controls-column">
            <PresetControls preset={preset} controls={selectedControls} outputFormat={formatForSession} upscaleMode={upscaleMode} formatDisabled={Boolean(submittedFormat)} disabled={isSubmitting} onPresetChange={handlePresetChange} onControlsChange={handleControlsChange} onOutputFormatChange={setOutputFormat} onUpscaleModeChange={setUpscaleMode} onReset={resetControls} onSubmit={handleSubmit} />
            <DownloadActions jobId={jobId} taskId={selectedTask?.taskId} format={formatForSession} href={downloadHref} batch={batchDownloads} onDownload={selectedTask?.taskId ? () => handleDownload(selectedTask.taskId, formatForSession) : undefined} onDownloadAll={handleDownloadAll} />
          </div>
        </div>
      </div>
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} onSave={setApiKey} currentKey={apiKey} />
    </main>
  );
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong. Please try again.";
}

function isExpiredError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "status" in error && error.status === 410;
}

function sameUploadConfig(left: UploadConfig, right: UploadConfig): boolean {
  return left.maxFileBytes === right.maxFileBytes &&
    left.maxPixels === right.maxPixels &&
    left.maxBatchSize === right.maxBatchSize &&
    left.supportedMimeTypes.join(",") === right.supportedMimeTypes.join(",");
}
