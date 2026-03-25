import { useState, useRef, useEffect, useCallback } from "react";
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

  const selectedOption = options.find((opt) => opt.value === value);

  const filteredOptions =
    filterable && filter
      ? options.filter(
          (opt) =>
            opt.label.toLowerCase().includes(filter.toLowerCase()) ||
            opt.value.toLowerCase().includes(filter.toLowerCase())
        )
      : options;

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

  useEffect(() => {
    if (isOpen) {
      updatePosition();
      if (filterable && filterInputRef.current) {
        filterInputRef.current.focus();
      }
      const idx = filteredOptions.findIndex((opt) => opt.value === value);
      setHighlightedIndex(idx >= 0 ? idx : 0);
    }
  }, [isOpen]);

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
          flex items-center justify-between gap-2 px-2.5 h-[30px] text-[12px] rounded-md w-full
          bg-surface-raised border border-border transition-all
          ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer hover:border-white/15"}
          ${isOpen ? "border-accent" : ""}
        `}
      >
        <span
          className={`truncate ${selectedOption ? "text-text" : "text-text-muted"}`}
        >
          {selectedOption ? selectedOption.label : placeholder}
        </span>
        <i
          className={`fa-solid fa-chevron-down text-text-muted text-[9px] transition-transform duration-150 ${
            isOpen
              ? openUpwards
                ? ""
                : "rotate-180"
              : openUpwards
                ? "rotate-180"
                : ""
          }`}
        />
      </button>

      {isOpen &&
        createPortal(
          <div
            ref={listRef}
            style={popupStyle}
            className="z-50 py-1 bg-surface-raised border border-border rounded-md shadow-xl max-h-52 overflow-y-auto"
            role="listbox"
          >
            {filterable && (
              <div className="px-1.5 pb-1.5 pt-1">
                <input
                  ref={filterInputRef}
                  type="text"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="Search..."
                  className="w-full px-2 py-1.5 text-[12px] bg-surface border border-border rounded-md focus:outline-none focus:border-accent text-text placeholder-text-muted transition-colors"
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={handleKeyDown}
                />
              </div>
            )}
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
                    w-full px-2.5 py-1.5 text-[12px] text-left transition-colors rounded-sm
                    ${index === highlightedIndex ? "bg-white/[0.06]" : ""}
                    ${option.value === value ? "text-text font-semibold" : "text-text"}
                  `}
                >
                  {option.label}
                </button>
              ))
            ) : (
              <div className="px-2.5 py-2 text-[12px] text-text-muted">
                No results
              </div>
            )}
          </div>,
          document.body
        )}
    </div>
  );
}
