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

  const allEnabled = enabled.size === AI_TOOLS.length;

  const toggleAll = () => {
    const next = allEnabled ? new Set<string>() : new Set(AI_TOOLS.map((t) => t.id));
    setEnabled(next);
    saveEnabledTools(next);
  };

  return (
    <div ref={popupRef} className="absolute bottom-full mb-1.5 left-0 w-[260px] bg-surface-panel border border-border rounded-lg shadow-xl z-50 overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-150">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <span className="text-[11px] font-semibold text-text-muted uppercase tracking-wide">AI Tools</span>
        <button
          onClick={toggleAll}
          className="text-[10px] text-accent hover:text-accent-hover transition-colors cursor-pointer"
        >
          {allEnabled ? "Disable all" : "Enable all"}
        </button>
      </div>
      <div className="p-1.5 max-h-[280px] overflow-y-auto space-y-0.5">
        {AI_TOOLS.map((tool) => {
          const isOn = enabled.has(tool.id);
          return (
            <button
              key={tool.id}
              onClick={() => toggle(tool.id)}
              className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-left transition-colors cursor-pointer ${
                isOn
                  ? "bg-accent/8 hover:bg-accent/12"
                  : "opacity-50 hover:opacity-70 hover:bg-surface-hover"
              }`}
            >
              <i className={`${tool.icon} text-[11px] w-4 text-center ${isOn ? "text-accent" : "text-text-muted"}`} />
              <div className="flex-1 min-w-0">
                <div className="text-[12px] font-medium text-text truncate">{tool.label}</div>
                <div className="text-[10px] text-text-muted leading-tight truncate">{tool.description}</div>
              </div>
              <div className={`w-3 h-3 rounded-full border flex-shrink-0 flex items-center justify-center ${
                isOn ? "border-accent bg-accent" : "border-white/20"
              }`}>
                {isOn && <i className="fa-solid fa-check text-[7px] text-white" />}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
