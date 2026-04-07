import { useEffect, useRef, useState } from "react";
import { AI_TOOLS, loadEnabledTools, saveEnabledTools } from "../lib/ai-tools";

interface Props {
  anchorRef: React.RefObject<HTMLButtonElement | null>;
  onClose: () => void;
}

export default function ToolsPopup({ anchorRef, onClose }: Props) {
  const [enabled, setEnabled] = useState(() => loadEnabledTools());
  const popupRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      const anchor = anchorRef.current;
      if (anchor && anchor.contains(e.target as Node)) return;
      if (popupRef.current && popupRef.current.contains(e.target as Node)) return;
      onClose();
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [onClose, anchorRef]);

  const toggle = (id: string) => {
    const next = new Set(enabled);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setEnabled(next);
    saveEnabledTools(next);
  };

  return (
    <div ref={popupRef} className="absolute bottom-full mb-1.5 left-0 w-[240px] bg-surface-raised border border-border/50 rounded-lg animate-popover-in p-1 shadow-md shadow-black/20">
      <div className="flex flex-col">
        {AI_TOOLS.map((tool) => {
          const isOn = enabled.has(tool.id);
          return (
            <button
              key={tool.id}
              onClick={() => toggle(tool.id)}
              className={`w-full flex items-center gap-2.5 px-2 py-1.5 rounded-md text-left transition-colors cursor-pointer select-none hover:bg-surface-hover/50`}
            >
              <i className={`${tool.icon} text-s w-4 text-center ${isOn ? "text-accent" : "text-text-muted opacity-80"}`} />
              <div className="flex-1 min-w-0 pr-2 flex flex-col gap-0.5">
                <div className={`text-xs font-medium truncate ${isOn ? "text-text" : "text-text/80"}`}>{tool.label}</div>
                <div className="text-[10px] text-text-muted leading-tight truncate">{tool.description}</div>
              </div>
              <div
                className={`w-4 h-4 rounded-[4px] border flex-shrink-0 flex items-center justify-center transition-all ${
                  isOn ? "bg-accent border-accent text-accent-text" : "border-border"
                }`}
              >
                {isOn && <i className="fa-solid fa-check text-[10px]" />}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
