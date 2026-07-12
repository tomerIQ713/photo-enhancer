import { useEffect, useMemo, useRef, useState } from "react";
import type { OutputFormat, Preset, UpscaleMode } from "./openrouter";
import { CanvasProcessor } from "./canvas-processor";
import { DownloadActions } from "./components/DownloadActions";
import { FileQueue } from "./components/FileQueue";
import { ImagePreview } from "./components/ImagePreview";
import { PresetControls } from "./components/PresetControls";
import { SettingsModal, getStoredApiKey } from "./components/SettingsModal";
import { UploadDropzone } from "./components/UploadDropzone";
import { mergeControls, OpenRouterClient, presetDefaults } from "./openrouter";
import "./styles.css";

interface ManualControls {
  strength: number;
  sharpness: number;
  noiseReduction: number;
  brightness: number;
  contrast: number;
}

interface ProcessedImage {
  id: string;
  file: File;
  status: "idle" | "analyzing" | "processing" | "complete" | "failed";
  originalObjectUrl: string;
  enhancedObjectUrl?: string;
  enhancedBlob?: Blob;
  outputFormat: OutputFormat;
  error?: string;
}

const DEFAULT_CONTROLS: ManualControls = {
  strength: 50, sharpness: 50, noiseReduction: 50, brightness: 50, contrast: 50
};

const PRESET_DEFAULTS: Record<Preset, ManualControls> = {
  auto: DEFAULT_CONTROLS,
  upscale: { strength: 70, sharpness: 70, noiseReduction: 35, brightness: 50, contrast: 55 }
};

let nextId = 0;

const openRouter = new OpenRouterClient();
const processor = new CanvasProcessor();

export function App() {
  const [files, setFiles] = useState<File[]>([]);
  const [preset, setPreset] = useState<Preset>("auto");
  const [upscaleMode, setUpscaleMode] = useState<UpscaleMode>("ai");
  const [controls, setControls] = useState<ManualControls>(DEFAULT_CONTROLS);
  const [controlsByIndex, setControlsByIndex] = useState<ManualControls[]>([]);
  const [outputFormat, setOutputFormat] = useState<OutputFormat>("png");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [processed, setProcessed] = useState<ProcessedImage[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string>();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [apiKey, setApiKey] = useState(getStoredApiKey);
  const [resultUnavailable, setResultUnavailable] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const selectedFile = files[selectedIndex];
  const selectedResult = processed[selectedIndex];
  const selectedControls = controlsByIndex[selectedIndex] ?? controls;
  const isComplete = selectedResult?.status === "complete";

  useEffect(() => {
    return () => { abortRef.current?.abort(); };
  }, []);

  const handleFilesSelected = (nextFiles: File[]) => {
    abortRef.current?.abort();
    setFiles(nextFiles);
    const nextControls = nextFiles.map(() => ({ ...PRESET_DEFAULTS[preset] }));
    setControlsByIndex(nextControls);
    setControls(PRESET_DEFAULTS[preset]);
    setProcessed([]);
    setSelectedIndex(0);
    setError(undefined);
    setResultUnavailable(false);
    setIsProcessing(false);
  };

  const handleSelect = (index: number) => {
    setSelectedIndex(index);
    setControls(controlsByIndex[index] ?? DEFAULT_CONTROLS);
  };

  const handleControlsChange = (nextControls: ManualControls) => {
    setControls(nextControls);
    setControlsByIndex(prev => prev.map((item, i) => i === selectedIndex ? nextControls : item));
  };

  const handlePresetChange = (nextPreset: Preset) => {
    setPreset(nextPreset);
    const nextControls = { ...PRESET_DEFAULTS[nextPreset] };
    setControls(nextControls);
    setControlsByIndex(prev => prev.map(() => ({ ...nextControls })));
  };

  const resetControls = () => handleControlsChange({ ...PRESET_DEFAULTS[preset] });

  const processImage = async (index: number, file: File, taskControls: ManualControls): Promise<void> => {
    const id = `img-${++nextId}`;
    const objectUrl = URL.createObjectURL(file);

    setProcessed(prev => [...prev, {
      id, file, status: "analyzing", originalObjectUrl: objectUrl, outputFormat
    }]);

    const update = (update: Partial<ProcessedImage>) => {
      setProcessed(prev => prev.map(p => p.id === id ? { ...p, ...update } : p));
    };

    try {
      const img = await loadImage(objectUrl);
      const fallback = presetDefaults(preset);
      let enhanced: HTMLImageElement | null = null;

      if (preset === "upscale" && upscaleMode === "ai") {
        update({ status: "processing" });
        enhanced = await openRouter.enhanceImage(img, taskControls, apiKey);
        if (enhanced) {
          const blob = await processor.imageToBlob(enhanced, outputFormat);
          const enhancedUrl = URL.createObjectURL(blob);
          update({ status: "complete", enhancedBlob: blob, enhancedObjectUrl: enhancedUrl });
          return;
        }
      }

      update({ status: "analyzing" });
      const params = await openRouter.analyze(img, preset, taskControls, apiKey);
      const merged = mergeControls(params, taskControls, preset);

      update({ status: "processing" });
      const blob = await processor.apply(img, merged, outputFormat);
      const enhancedUrl = URL.createObjectURL(blob);
      update({ status: "complete", enhancedBlob: blob, enhancedObjectUrl: enhancedUrl });
    } catch (err) {
      update({ status: "failed", error: "Processing failed" });
    }
  };

  const handleSubmit = async () => {
    if (files.length === 0) { setError("Select at least one photo."); return; }
    if (isProcessing) return;
    abortRef.current?.abort();
    abortRef.current = new AbortController();

    setProcessed([]);
    setError(undefined);
    setResultUnavailable(false);
    setIsProcessing(true);

    for (let i = 0; i < files.length; i++) {
      if (abortRef.current?.signal.aborted) break;
      await processImage(i, files[i], controlsByIndex[i] ?? controls);
    }
    setIsProcessing(false);
  };

  const handleDownload = async () => {
    const result = processed[selectedIndex];
    if (!result?.enhancedBlob) return;
    const url = URL.createObjectURL(result.enhancedBlob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `photo-enhanced.${result.outputFormat}`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadAll = async () => {
    for (const result of processed) {
      if (!result.enhancedBlob) continue;
      const url = URL.createObjectURL(result.enhancedBlob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `photo-enhanced.${result.outputFormat}`;
      link.click();
      URL.revokeObjectURL(url);
      await new Promise(r => setTimeout(r, 300));
    }
  };

  const handleEnhanceAnother = () => {
    handleFilesSelected([]);
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Photo Enhancer home"><span className="brand-mark">PE</span> Photo Enhancer</a>
        <span className="session-note">Runs in your browser · your key stays local</span>
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
        <UploadDropzone files={files} config={{ maxFileBytes: 10 * 1024 * 1024, maxPixels: 25_000_000, maxBatchSize: 5, supportedMimeTypes: ["image/jpeg", "image/png", "image/webp", "image/avif"] }} onFilesSelected={handleFilesSelected} onValidationError={setError} />
        {error && <div className="error-message" role="alert">{error}</div>}
        <div className="workbench-grid">
          <FileQueue files={files} tasks={processed.map(p => ({ taskId: p.id, status: p.status === "idle" ? "queued" : p.status as any, error: p.error }))} selectedIndex={selectedIndex} onSelect={handleSelect} pendingRetryTaskId={undefined} />
          <ImagePreview sourceFile={selectedFile} previewUrl={selectedResult?.enhancedObjectUrl} taskStatus={selectedResult?.status} taskError={selectedResult?.error} resultUnavailable={resultUnavailable} onResultUnavailable={() => setResultUnavailable(true)} onEnhanceAnother={handleEnhanceAnother} />
          <div className="controls-column">
            <PresetControls preset={preset} controls={selectedControls} outputFormat={outputFormat} upscaleMode={upscaleMode} disabled={isProcessing} onPresetChange={handlePresetChange} onControlsChange={handleControlsChange} onOutputFormatChange={(f) => { setOutputFormat(f); setProcessed(prev => prev.map(p => p.id === selectedResult?.id ? { ...p, outputFormat: f } : p)); }} onUpscaleModeChange={setUpscaleMode} onReset={resetControls} onSubmit={handleSubmit} />
            <DownloadActions jobId="" taskId={selectedResult?.id ?? ""} format={outputFormat} href="" batch={processed.filter(p => p.status === "complete").map(p => ({ taskId: p.id, format: p.outputFormat, href: "" }))} onDownload={isComplete ? handleDownload : undefined} onDownloadAll={handleDownloadAll} />
          </div>
        </div>
      </div>
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} onSave={setApiKey} currentKey={apiKey} />
    </main>
  );
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to load image"));
    img.src = url;
  });
}
