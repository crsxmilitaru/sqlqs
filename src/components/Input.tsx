import { splitProps } from "solid-js";
import type { JSX } from "solid-js";

type Props = JSX.InputHTMLAttributes<HTMLInputElement>;

export default function Input(props: Props) {
  const [local, rest] = splitProps(props, ["class", "disabled", "ref"]);
  return (
    <input
      ref={local.ref}
      disabled={local.disabled}
      class={`
          flex items-center px-2.5 h-[32px] text-m rounded-md w-full
          bg-white/[0.08] border border-white/10 transition-all
          text-text placeholder-text-muted
          focus:border-accent/40 focus:ring-1 focus:ring-accent/20 focus:outline-none
          ${local.disabled ? "opacity-50 cursor-not-allowed" : "hover:bg-white/[0.12] hover:border-white/20"}
          ${local.class || ""}
        `}
      {...rest}
    />
  );
}
