import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

interface DropdownOption {
  value: string;
  label: string;
}

interface Props {
  value: string;
  options: DropdownOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  filterable?: boolean;
  openUpwards?: boolean;
}

export default function Dropdown({
  value,
  options,
  onChange,
  placeholder = "Select...",
  disabled = false,
  className = "",
  filterable = false,
  openUpwards = false,
}: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [popupStyle, setPopupStyle] = useState<React.CSSProperties>({});
  const dropdownRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const filterInputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const portalTarget =
    typeof document !== "undefined"
      ? ((dropdownRef.current?.closest(".app-shell") as HTMLElement | null) ?? document.body)
      : null;

  const selectedOption = useMemo(() => options.find((opt) => opt.value === value), [options, value]);

  const filteredOptions = useMemo(() => 
    filterable && filter
      ? options.filter(
        (opt) =>
          opt.label.toLowerCase().includes(filter.toLowerCase()) ||
          opt.value.toLowerCase().includes(filter.toLowerCase())
      )
      : options,
    [filterable, filter, options]
  );

  const close = useCallback(() => {
    setIsOpen(false);
    setFilter("");
    setHighlightedIndex(-1);
  }, []);

  const updatePosition = useCallback(() => {
    if (!buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    if (openUpwards) {
      setPopupStyle({
        position: "fixed",
        left: rect.left,
        bottom: window.innerHeight - rect.top + 4,
        width: rect.width,
      });
    } else {
      setPopupStyle({
        position: "fixed",
        left: rect.left,
        top: rect.bottom + 4,
        width: rect.width,
      });
    }
  }, [openUpwards]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node) &&
        listRef.current &&
        !listRef.current.contains(event.target as Node)
      ) {
        close();
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [close]);

  useLayoutEffect(() => {
    if (!isOpen) return;

    updatePosition();
    if (filterable && filterInputRef.current) {
      filterInputRef.current.focus();
    }

    const idx = filteredOptions.findIndex((opt) => opt.value === value);
    setHighlightedIndex(idx >= 0 ? idx : 0);

    const handleReposition = () => updatePosition();
    window.addEventListener("resize", handleReposition);
    window.addEventListener("scroll", handleReposition, true);

    return () => {
      window.removeEventListener("resize", handleReposition);
      window.removeEventListener("scroll", handleReposition, true);
    };
  }, [filterable, filteredOptions, isOpen, updatePosition, value]);

  // scroll highlighted item into view
  useEffect(() => {
    if (highlightedIndex >= 0 && itemRefs.current[highlightedIndex]) {
      itemRefs.current[highlightedIndex]?.scrollIntoView({ block: "nearest" });
    }
  }, [highlightedIndex]);

  // reset highlight when filter changes
  useEffect(() => {
    setHighlightedIndex(filteredOptions.length > 0 ? 0 : -1);
  }, [filter]);

  const handleSelect = (optionValue: string) => {
    onChange(optionValue);
    close();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        setIsOpen(true);
      }
      return;
    }

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setHighlightedIndex((prev) =>
          prev < filteredOptions.length - 1 ? prev + 1 : 0
        );
        break;
      case "ArrowUp":
        e.preventDefault();
        setHighlightedIndex((prev) =>
          prev > 0 ? prev - 1 : filteredOptions.length - 1
        );
        break;
      case "Enter":
        e.preventDefault();
        if (highlightedIndex >= 0 && filteredOptions[highlightedIndex]) {
          handleSelect(filteredOptions[highlightedIndex].value);
        }
        break;
      case "Escape":
        e.preventDefault();
        close();
        break;
      case "Tab":
        close();
        break;
    }
  };

  return (
    <div
      ref={dropdownRef}
      className={`relative ${className}`}
      onKeyDown={handleKeyDown}
    >
      <button
        ref={buttonRef}
        type="button"
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
        className={`
          dropdown-trigger
          flex items-center justify-between gap-2 px-2.5 h-[32px] text-m rounded-md w-full
          transition-all
          text-text placeholder-text-muted
          focus:border-accent/40 focus:ring-1 focus:ring-accent/20 focus:outline-none
          ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}
        `}
      >
        <span
          className={`truncate ${selectedOption ? "text-text" : "text-text-muted"}`}
        >
          {selectedOption ? selectedOption.label : placeholder}
        </span>
        <i
          className={`fa-solid fa-chevron-down text-text-muted text-icon transition-transform duration-150 ${isOpen
              ? openUpwards
                ? ""
                : "rotate-180"
              : openUpwards
                ? "rotate-180"
                : ""
            }`}
        />
      </button>

      {isOpen && portalTarget &&
        createPortal(
          <div
            ref={listRef}
            style={popupStyle}
            className="dropdown-panel z-[100] py-1 backdrop-blur-xl rounded-lg max-h-52 flex flex-col items-stretch animate-in fade-in-0 zoom-in-95 duration-100"
            role="listbox"
          >
            {filterable && (
              <div className="px-2 pb-2 pt-1 flex-shrink-0 border-b border-border/5">
                <div className="dropdown-search flex items-center gap-2 h-8 px-2.5 rounded-md transition-all">
                  <i className="fa-solid fa-magnifying-glass text-3xs opacity-40" />
                  <input
                    ref={filterInputRef}
                    type="text"
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                    placeholder="Search databases..."
                    className="w-full bg-transparent text-m text-text caret-accent placeholder:text-text-muted/60 outline-none"
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={handleKeyDown}
                  />
                </div>
              </div>
            )}
            <div className="flex-1 overflow-y-auto">
              {filteredOptions.length > 0 ? (
                filteredOptions.map((option, index) => (
                  <button
                    key={option.value}
                    ref={(el) => {
                      itemRefs.current[index] = el;
                    }}
                    type="button"
                    role="option"
                    aria-selected={option.value === value}
                    onClick={() => handleSelect(option.value)}
                    onMouseEnter={() => setHighlightedIndex(index)}
                    className={`
                      dropdown-option w-full px-2.5 py-1.5 text-m text-left transition-colors rounded-sm cursor-pointer
                      ${index === highlightedIndex ? "dropdown-option--active" : ""}
                      ${option.value === value ? "dropdown-option--selected" : ""}
                    `}
                  >
                    {option.label}
                  </button>
                ))
              ) : (
                <div className="px-2.5 py-2 text-sm text-text-muted">
                  No results
                </div>
              )}
            </div>
          </div>,
          portalTarget
        )}
    </div>
  );
}
