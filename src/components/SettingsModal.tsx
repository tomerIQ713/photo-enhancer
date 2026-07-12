import { useEffect, useRef, useState } from "react";

const STORAGE_KEY = "openrouter-api-key";

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
  onSave: (key: string) => void;
  currentKey: string;
}

export function getStoredApiKey(): string {
  try {
    return sessionStorage.getItem(STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

export function setStoredApiKey(key: string): void {
  try {
    if (key) {
      sessionStorage.setItem(STORAGE_KEY, key);
    } else {
      sessionStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // sessionStorage may be unavailable in restricted contexts
  }
}

export function SettingsModal({ open, onClose, onSave, currentKey }: SettingsModalProps) {
  const [value, setValue] = useState(currentKey);
  const [showKey, setShowKey] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setValue(currentKey);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open, currentKey]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const handleSave = () => {
    const trimmed = value.trim();
    setStoredApiKey(trimmed);
    onSave(trimmed);
    onClose();
  };

  const handleClear = () => {
    setValue("");
    setStoredApiKey("");
    onSave("");
  };

  return (
    <div className="modal-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="settings-heading">
      <div className="modal-content" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <h2 id="settings-heading">Settings</h2>
          <button className="text-button modal-close" type="button" onClick={onClose} aria-label="Close settings">×</button>
        </div>
        <div className="modal-body">
          <label className="settings-field">
            <span>OpenRouter API Key</span>
            <div className="key-input-row">
              <input
                ref={inputRef}
                type={showKey ? "text" : "password"}
                value={value}
                placeholder="sk-or-v1-..."
                onChange={(event) => setValue(event.target.value)}
                autoComplete="off"
                spellCheck={false}
              />
              <button
                type="button"
                className="text-button"
                onClick={() => setShowKey(!showKey)}
                aria-label={showKey ? "Hide key" : "Show key"}
              >
                {showKey ? "Hide" : "Show"}
              </button>
            </div>
          </label>
          <p className="settings-note">
            Your key is stored only in this browser session and sent with each enhancement request.
            It is never saved to the server or stored in project files.
          </p>
          <p className="settings-note">
            Get a key at <a href="https://openrouter.ai/keys" target="_blank" rel="noopener noreferrer">openrouter.ai/keys</a>
          </p>
        </div>
        <div className="modal-footer">
          <button className="text-button" type="button" onClick={handleClear}>Clear</button>
          <button className="primary-button" type="button" onClick={handleSave}>Save</button>
        </div>
      </div>
    </div>
  );
}
