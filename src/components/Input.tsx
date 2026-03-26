import { forwardRef } from "react";

interface Props extends React.InputHTMLAttributes<HTMLInputElement> {}

const Input = forwardRef<HTMLInputElement, Props>(
  ({ className = "", disabled, ...rest }, ref) => {
    return (
      <input
        ref={ref}
        disabled={disabled}
        className={`
          flex items-center px-2.5 h-[30px] text-[12px] rounded-md w-full
          bg-surface-raised border border-border transition-all
          text-text placeholder-text-muted
          focus:border-accent focus:shadow-[0_0_0_2px_color-mix(in_srgb,var(--color-accent)_30%,transparent)] focus:outline-none
          ${disabled ? "opacity-50 cursor-not-allowed" : "hover:border-white/15"}
          ${className}
        `}
        {...rest}
      />
    );
  }
);

Input.displayName = "Input";

export default Input;
