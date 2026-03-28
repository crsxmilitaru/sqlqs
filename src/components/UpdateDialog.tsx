import { useEffect, useState } from "react";

interface Props {
  version: string;
  currentVersion: string;
  onInstall: () => void;
  onCancel: () => void;
}

export default function UpdateDialog({ version, currentVersion, onInstall, onCancel }: Props) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onCancel();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onCancel]);

  return (
    <div
      className={`absolute top-11 inset-x-0 bottom-0 z-[120] flex items-center justify-center bg-black/50 transition-opacity duration-200 ${visible ? "opacity-100" : "opacity-0"}`}
      onMouseDown={onCancel}
      role="dialog"
      aria-modal="true"
    >
      <div
        className={`w-[460px] max-w-[94vw] rounded-2xl border border-white/[0.08] bg-surface-raised p-6 shadow-2xl transition-all duration-200 ${visible ? "opacity-100 scale-100 translate-y-0" : "opacity-0 scale-[0.97] translate-y-2"}`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="mb-6 flex items-start gap-4">
          <div className="mt-0.5 flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent">
            <i className="fa-solid fa-circle-arrow-up text-lg" />
          </div>
          <div>
            <h2 className="mb-1 text-lg font-semibold text-text">Update available</h2>
            <p className="text-sm text-text-muted">
              Version {version} is ready to install. You are currently running {currentVersion}.
            </p>
          </div>
        </div>

        <div className="flex justify-end gap-3 border-t border-border pt-4">
          <button onClick={onCancel} className="btn btn-secondary px-5 py-1.5">
            Later
          </button>
          <button onClick={onInstall} className="btn btn-primary px-5 py-1.5">
            Install update
          </button>
        </div>
      </div>
    </div>
  );
}
