import { useEffect, useState, type CSSProperties } from "react";

interface ImagePreviewProps {
  originalUrl?: string;
  outputUrl?: string;
  taskStatus?: string;
}

export function ImagePreview({ originalUrl, outputUrl, taskStatus }: ImagePreviewProps) {
  const [comparison, setComparison] = useState(50);

  useEffect(() => setComparison(50), [originalUrl, outputUrl]);

  if (!originalUrl && !outputUrl) {
    return (
      <section className="preview-stage empty-preview" aria-labelledby="preview-heading">
        <p className="section-kicker">Preview</p>
        <h2 id="preview-heading">Your enhanced image will appear here</h2>
        <p>Upload a photo to inspect the original and enhanced result side by side.</p>
      </section>
    );
  }

  const before = originalUrl ?? outputUrl;
  const after = outputUrl ?? originalUrl;
  const isComplete = taskStatus === "complete" && Boolean(outputUrl);

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
