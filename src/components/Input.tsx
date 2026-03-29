import { forwardRef } from "react";

interface Props extends React.InputHTMLAttributes<HTMLInputElement> {}

const Input = forwardRef<HTMLInputElement, Props>(
  ({ className = "", disabled, ...rest }, ref) => {
    return (
      <input
        ref={ref}
        disabled={disabled}
        className={`
          flex items-center px-2.5 h-[32px] text-m rounded-md w-full
          bg-white/[0.08] border border-white/10 transition-all
          text-text placeholder-text-muted
          focus:border-accent/40 focus:ring-1 focus:ring-accent/20 focus:outline-none
          ${disabled ? "opacity-50 cursor-not-allowed" : "hover:bg-white/[0.12] hover:border-white/20"}
          ${className}
        `}
        {...rest}
      />
    );
  }
);

Input.displayName = "Input";

export default Input;
