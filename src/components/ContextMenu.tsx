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

  const renderItem = (item: ContextMenuItem, isSubmenuItem = false) => {
    const itemClassName = `popup-menu-item rounded-md mx-1 w-[calc(100%-8px)] ${
      item.disabled
        ? "opacity-50 cursor-default hover:bg-transparent hover:text-text-muted"
        : item.danger
          ? "text-error hover:bg-error/10 hover:text-error"
          : ""
    }`;

    return (
      <button
        key={item.id}
        className={itemClassName}
        onClick={(e) => {
          e.stopPropagation();
          handleItemClick(item);
        }}
        onMouseEnter={() => {
          if (!isSubmenuItem) {
            setActiveSubmenu(item.children ? item.id : null);
          }
        }}
        disabled={item.disabled}
      >
        {item.icon && (
          <span className="w-4 h-4 flex items-center justify-center flex-shrink-0 opacity-90 text-white [&_i]:!text-white [&_svg]:!text-white">
            {item.icon}
          </span>
        )}
        <span className="flex-1">{item.label}</span>
        {item.shortcut && (
          <span className="text-text-muted text-3xs ml-4">
            {item.shortcut}
          </span>
        )}
        {item.children && !isSubmenuItem && (
          <i className="fa-solid fa-chevron-right text-icon-xs text-white/50" />
        )}
      </button>
    );
  };

  return (
    <div
      ref={menuRef}
      className="popup-menu fixed rounded-lg animate-popover-in"
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
            {renderItem(item)}

            {item.children && activeSubmenu === item.id && (
              <div className="popup-menu absolute left-full -top-2 -ml-1 rounded-lg animate-popover-in">
                {item.children.map((child) => renderItem(child, true))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
