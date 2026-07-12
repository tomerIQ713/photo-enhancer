import { useEffect, useState, type CSSProperties } from "react";

interface ImagePreviewProps {
  sourceFile?: File;
  previewUrl?: string;
  taskStatus?: string;
  taskError?: string;
  onEnhanceAnother?: () => void;
}

export function ImagePreview({ sourceFile, previewUrl, taskStatus, taskError, onEnhanceAnother }: ImagePreviewProps) {
  const [comparison, setComparison] = useState(50);
  const [originalObjectUrl, setOriginalObjectUrl] = useState<string>();

  useEffect(() => {
    if (!sourceFile || typeof URL.createObjectURL !== "function") {
      setOriginalObjectUrl(undefined);
      return;
    }
    const objectUrl = URL.createObjectURL(sourceFile);
    setOriginalObjectUrl(objectUrl);
    return () => {
      URL.revokeObjectURL(objectUrl);
    };
  }, [sourceFile]);

  useEffect(() => setComparison(50), [previewUrl, sourceFile]);

  if (taskStatus === "failed") {
    return (
      <section className="preview-stage failed-preview" aria-labelledby="preview-heading">
        <div className="preview-header">
          <div><p className="section-kicker">Preview</p><h2 id="preview-heading">Enhancement failed</h2></div>
          <span className="preview-status">Failed</span>
        </div>
        <p className="preview-error" role="alert">{taskError ?? "This photo could not be enhanced."}</p>
        {originalObjectUrl && <img className="single-preview-image" src={originalObjectUrl} alt="Original photo" />}
      </section>
    );
  }

  if (taskStatus === "complete" && !previewUrl) {
    return (
      <section className="preview-stage unavailable-preview" aria-labelledby="preview-heading">
        <div className="preview-header">
          <div><p className="section-kicker">Preview</p><h2 id="preview-heading">Result unavailable or expired</h2></div>
          <span className="preview-status">Unavailable</span>
        </div>
        <p className="preview-error" role="status">The completed result is no longer available, so there is no preview or download for this task.</p>
        {onEnhanceAnother && <button className="primary-button" type="button" onClick={onEnhanceAnother}>Enhance another</button>}
      </section>
    );
  }

  if (!originalObjectUrl && !previewUrl) {
    return (
      <section className="preview-stage empty-preview" aria-labelledby="preview-heading">
        <p className="section-kicker">Preview</p>
        <h2 id="preview-heading">Your enhanced image will appear here</h2>
        <p>Upload a photo to inspect the original and enhanced result side by side.</p>
      </section>
    );
  }

  const before = originalObjectUrl ?? previewUrl;
  const after = previewUrl ?? originalObjectUrl;
  const isComplete = taskStatus === "complete" && Boolean(previewUrl);

  return (
    <section className="preview-stage" aria-labelledby="preview-heading">
      <div className="preview-header">
        <div><p className="section-kicker">Preview</p><h2 id="preview-heading">{isComplete ? "Before and after" : "Processing image"}</h2></div>
        <span className="preview-status">{isComplete ? "Ready to review" : "Working"}</span>
      </div>
      <div className="comparison" style={{ "--comparison": `${comparison}%` } as CSSProperties}>
        <img className="comparison-image base-image" src={before} alt="Original photo" />
        <div className="enhanced-clip"><img className="comparison-image" src={after} alt="Enhanced photo" /></div>
        {isComplete && <span className="comparison-label label-before">Before</span>}
        {isComplete && <span className="comparison-label label-after">After</span>}
      </div>
      {isComplete && (
        <label className="comparison-control">
          <span>Slide to compare</span>
          <input type="range" min="0" max="100" value={comparison} aria-label="Before and after comparison" onChange={(event) => setComparison(Number(event.target.value))} />
        </label>
      )}
    </section>
  );
}
