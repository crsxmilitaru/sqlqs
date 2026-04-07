import { useEffect, useRef } from "react";
import type { ColumnInfo } from "../lib/types";

interface Props {
  columns: ColumnInfo[];
  hiddenColumnIndices: Set<number>;
  onToggle: (index: number) => void;
  onToggleAll: (showAll: boolean) => void;
  anchorRef: React.RefObject<HTMLButtonElement | null>;
  onClose: () => void;
}

export default function ColumnSelector({
  columns,
  hiddenColumnIndices,
  onToggle,
  onToggleAll,
  anchorRef,
  onClose,
}: Props) {
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

  const allVisible = hiddenColumnIndices.size === 0;

  return (
    <div
      ref={popupRef}
      className="absolute top-full mt-1 right-0 w-[240px] bg-surface-panel border border-border rounded-lg z-50 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150 shadow-md shadow-black/20"
    >
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-border bg-surface-header/30">
        <span className="text-[10px] font-bold text-text-muted uppercase tracking-wider">
          Column Visibility
        </span>
        <button
          onClick={() => onToggleAll(allVisible)}
          className="text-[10px] font-medium text-accent hover:text-accent-hover transition-colors cursor-pointer"
        >
          {allVisible ? "Hide All" : "Show All"}
        </button>
      </div>
      <div className="p-1 max-h-[320px] overflow-y-auto custom-scrollbar">
        {columns.map((col, i) => {
          const isVisible = !hiddenColumnIndices.has(i);
          return (
            <button
              key={i}
              onClick={() => onToggle(i)}
              className={`w-full flex items-center gap-3 px-2.5 py-2 rounded-md text-left transition-all cursor-pointer group ${isVisible
                  ? "hover:bg-surface-hover"
                  : "opacity-40 hover:opacity-60 hover:bg-surface-hover"
                }`}
            >
              <div
                className={`w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center transition-all ${isVisible
                    ? "border-accent bg-accent"
                    : "border-border bg-surface-header"
                  }`}
              >
                {isVisible && <i className="fa-solid fa-check text-[10px] text-white" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className={`text-xs font-medium truncate ${isVisible ? "text-text" : "text-text-muted"}`}>
                  {col.name}
                </div>
                <div className="text-[10px] text-text-muted/60 font-normal uppercase tracking-tighter truncate">
                  {col.type_name}
                </div>
              </div>
            </button>
          );
        })}
      </div>
      {hiddenColumnIndices.size > 0 && (
        <div className="px-3 py-2 bg-accent/5 border-t border-accent/10">
          <p className="text-[10px] text-accent/80 font-medium italic">
            {hiddenColumnIndices.size} column{hiddenColumnIndices.size > 1 ? "s" : ""} hidden
          </p>
        </div>
      )}
    </div>
  );
}
