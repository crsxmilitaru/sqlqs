import { useCallback, useEffect, useRef, useState } from "react";

export interface ContextMenuItem {
  id: string;
  label?: string;
  icon?: React.ReactNode;
  shortcut?: string;
  disabled?: boolean;
  danger?: boolean;
  separator?: boolean;
  children?: ContextMenuItem[];
  onClick?: () => void;
}

interface Props {
  items: ContextMenuItem[];
  x: number;
  y: number;
  onClose: () => void;
}

export default function ContextMenu({ items, x, y, onClose }: Props) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x, y });
  const [activeSubmenu, setActiveSubmenu] = useState<string | null>(null);

  useEffect(() => {
    if (menuRef.current) {
      const rect = menuRef.current.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      let newX = x;
      let newY = y;

      if (x + rect.width > viewportWidth) {
        newX = viewportWidth - rect.width - 8;
      }
      if (y + rect.height > viewportHeight) {
        newY = viewportHeight - rect.height - 8;
      }

      setPosition({ x: Math.max(8, newX), y: Math.max(8, newY) });
    }
  }, [x, y]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [onClose]);

  const handleItemClick = useCallback(
    (item: ContextMenuItem) => {
      if (item.disabled || item.separator) return;
      if (item.children) {
        setActiveSubmenu(activeSubmenu === item.id ? null : item.id);
        return;
      }
      item.onClick?.();
      onClose();
    },
    [activeSubmenu, onClose],
  );

  return (
    <div
      ref={menuRef}
      className="fixed z-50 min-w-[200px] p-1.5 bg-surface-raised/95 backdrop-blur-xl border border-border/50 rounded-lg shadow-2xl shadow-black/60 animate-in fade-in-0 zoom-in-95 duration-150"
      style={{ left: position.x, top: position.y }}
    >
      {items.map((item, index) => {
        if (item.separator) {
          return (
            <div
              key={`separator-${index}`}
              className="my-1.5 h-px bg-border/50 mx-2"
            />
          );
        }

        return (
          <div key={item.id} className="relative">
            <button
              className={`flex items-center gap-3 px-3 py-1.5 text-left text-[13px] transition-all rounded-md mx-0.5 w-[calc(100%-4px)] ${item.disabled
                ? "text-text-muted/50 cursor-default"
                : item.danger
                  ? "text-error hover:bg-error/10"
                  : "text-text hover:bg-white/10"
                }`}
              onClick={() => handleItemClick(item)}
              onMouseEnter={() => {
                setActiveSubmenu(item.children ? item.id : null);
              }}
            >
              {item.icon && (
                <span className="w-4 h-4 flex items-center justify-center flex-shrink-0 opacity-90 text-white [&_i]:!text-white [&_svg]:!text-white">
                  {item.icon}
                </span>
              )}
              <span className="flex-1">{item.label}</span>
              {item.shortcut && (
                <span className="text-text-muted text-[10px] ml-4">
                  {item.shortcut}
                </span>
              )}
              {item.children && (
                <i className="fa-solid fa-chevron-right text-[8px] text-white/50" />
              )}
            </button>

            {item.children && activeSubmenu === item.id && (
              <div className="absolute left-full -top-1.5 -ml-1.5 min-w-[200px] p-1.5 bg-surface-raised/95 backdrop-blur-xl border border-border/50 rounded-lg shadow-2xl shadow-black/60 animate-in fade-in-0 zoom-in-95 duration-150">
                {item.children.map((child) => (
                  <button
                    key={child.id}
                    className={`flex items-center gap-3 px-3 py-1.5 text-left text-[13px] transition-all rounded-md mx-0.5 w-[calc(100%-4px)] ${child.disabled
                      ? "text-text-muted/50 cursor-default"
                      : child.danger
                        ? "text-error hover:bg-error/10"
                        : "text-text hover:bg-white/10"
                      }`}
                    onClick={() => {
                      if (!child.disabled) {
                        child.onClick?.();
                        onClose();
                      }
                    }}
                  >
                    {child.icon && (
                      <span className="w-4 h-4 flex items-center justify-center flex-shrink-0 opacity-90 text-white [&_i]:!text-white [&_svg]:!text-white">
                        {child.icon}
                      </span>
                    )}
                    <span className="flex-1">{child.label}</span>
                    {child.shortcut && (
                      <span className="text-text-muted text-[10px] ml-4">
                        {child.shortcut}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}