import type { ManualControls, OutputFormat, Preset, UpscaleMode } from "../types";

interface PresetControlsProps {
  preset: Preset;
  controls: ManualControls;
  outputFormat: OutputFormat;
  upscaleMode: UpscaleMode;
  disabled?: boolean;
  formatDisabled?: boolean;
  onPresetChange: (preset: Preset) => void;
  onControlsChange: (controls: ManualControls) => void;
  onOutputFormatChange: (format: OutputFormat) => void;
  onUpscaleModeChange: (mode: UpscaleMode) => void;
  onReset: () => void;
  onSubmit: () => void;
}

const fields: Array<[keyof ManualControls, string]> = [
  ["strength", "Enhancement strength"],
  ["sharpness", "Sharpness"],
  ["noiseReduction", "Noise reduction"],
  ["brightness", "Brightness"],
  ["contrast", "Contrast"]
];

export function PresetControls({
  preset,
  controls,
  outputFormat,
  upscaleMode,
  disabled = false,
  formatDisabled = false,
  onPresetChange,
  onControlsChange,
  onOutputFormatChange,
  onUpscaleModeChange,
  onReset,
  onSubmit
}: PresetControlsProps) {
  return (
    <section className="panel controls-panel" aria-labelledby="controls-heading">
      <div className="panel-heading">
        <div>
          <p className="section-kicker">Enhancement</p>
          <h2 id="controls-heading">Choose a finish</h2>
        </div>
      </div>
      <div className="preset-group" role="group" aria-label="Enhancement preset">
        <button type="button" className={preset === "auto" ? "preset-button is-active" : "preset-button"} onClick={() => onPresetChange("auto")} disabled={disabled}>
          <strong>Auto enhance</strong><span>Balanced correction for everyday photos</span>
        </button>
        <button type="button" className={preset === "upscale" ? "preset-button is-active" : "preset-button"} onClick={() => onPresetChange("upscale")} disabled={disabled}>
          <strong>Upscale</strong><span>Bring out detail in smaller images</span>
        </button>
      </div>
      {preset === "upscale" && (
        <div className="upscale-mode-group" role="group" aria-label="Upscale method">
          <button
            type="button"
            className={upscaleMode === "ai" ? "mode-button is-active" : "mode-button"}
            onClick={() => onUpscaleModeChange("ai")}
            disabled={disabled}
          >
            <strong>AI Upscale</strong><span>Generates new detail using AI image-to-image</span>
          </button>
          <button
            type="button"
            className={upscaleMode === "classic" ? "mode-button is-active" : "mode-button"}
            onClick={() => onUpscaleModeChange("classic")}
            disabled={disabled}
          >
            <strong>Classic Upscale</strong><span>Lanczos3 interpolation, no AI</span>
          </button>
        </div>
      )}
      <div className="control-list">
        {fields.map(([name, label]) => (
          <label className="range-field" key={name}>
            <span><span>{label}</span><output>{controls[name]}</output></span>
            <input
              type="range"
              min="0"
              max="100"
              value={controls[name]}
              aria-label={label}
              disabled={disabled}
              onChange={(event) => onControlsChange({ ...controls, [name]: Number(event.target.value) })}
            />
          </label>
        ))}
      </div>
      <button className="text-button reset-button" type="button" onClick={onReset} disabled={disabled}>
        Reset controls to preset defaults
      </button>
      <label className="format-field">
        <span>Download format</span>
        <select value={outputFormat} disabled={disabled || formatDisabled} onChange={(event) => onOutputFormatChange(event.target.value as OutputFormat)}>
          <option value="png">PNG</option>
          <option value="jpg">JPG</option>
        </select>
      </label>
      <button className="primary-button" type="button" onClick={onSubmit} disabled={disabled}>
        {disabled ? "Enhancing photos..." : "Enhance photos"}
      </button>
    </section>
  );
}
