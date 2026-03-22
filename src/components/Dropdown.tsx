import { useState, useRef, useEffect } from "react";

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
  const dropdownRef = useRef<HTMLDivElement>(null);
  const filterInputRef = useRef<HTMLInputElement>(null);

  const selectedOption = options.find((opt) => opt.value === value);

  const filteredOptions = filterable && filter
    ? options.filter((opt) =>
        opt.label.toLowerCase().includes(filter.toLowerCase()) ||
        opt.value.toLowerCase().includes(filter.toLowerCase())
      )
    : options;

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setFilter("");
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  useEffect(() => {
    if (isOpen && filterable && filterInputRef.current) {
      filterInputRef.current.focus();
    }
  }, [isOpen, filterable]);

  const handleSelect = (optionValue: string) => {
    onChange(optionValue);
    setIsOpen(false);
    setFilter("");
  };

  return (
    <div ref={dropdownRef} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
        className={`
          winui-input flex items-center justify-between gap-2 px-3 py-1.5 text-xs rounded-lg w-full
          ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}
          ${isOpen ? "border-accent" : ""}
        `}
      >
        <span className={selectedOption ? "text-text" : "text-text-muted"}>
          {selectedOption ? selectedOption.label : placeholder}
        </span>
        <i className={`fa-solid fa-chevron-down text-text-muted text-[10px] transition-transform ${isOpen ? (openUpwards ? "" : "rotate-180") : (openUpwards ? "rotate-180" : "")}`} />
      </button>

      {isOpen && (
        <div
          className={`
            absolute z-50 w-full py-1
            bg-surface border border-border rounded-lg shadow-lg
            max-h-60 overflow-y-auto
            ${openUpwards ? "bottom-full mb-1" : "top-full mt-1"}
          `}
        >
          {filterable && (
            <div className="px-2 py-1.5 border-b border-border">
              <input
                ref={filterInputRef}
                type="text"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Filter..."
                className="w-full px-2 py-1 text-xs bg-surface-raised border border-border rounded focus:outline-none focus:border-accent text-text placeholder-text-muted"
                onClick={(e) => e.stopPropagation()}
              />
            </div>
          )}
          {filteredOptions.length > 0 ? (
            filteredOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => handleSelect(option.value)}
                className={`
                  w-full px-3 py-2 text-xs text-left
                  hover:bg-surface-overlay transition-colors
                  ${option.value === value ? "bg-surface-overlay text-accent" : "text-text"}
                `}
              >
                {option.label}
              </button>
            ))
          ) : (
            <div className="px-3 py-2 text-xs text-text-muted">No options found</div>
          )}
        </div>
      )}
    </div>
  );
}
