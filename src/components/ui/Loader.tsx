import { Show } from "solid-js";
import { Spinner } from "./Icons";

interface LoaderProps {
  class?: string;
  size?: number;
  text?: string;
  variant?: "horizontal" | "vertical" | "inline";
}

export function Loader(props: LoaderProps) {
  const size = () => props.size ?? (props.variant === "vertical" ? 32 : 14);

  return (
    <Show
      when={props.variant === "vertical"}
      fallback={
        <div
          class={`flex items-center gap-2.5 text-text-muted text-s font-medium ${
            props.variant === "horizontal" ? "justify-center py-8" : ""
          } ${props.class || ""}`}
        >
          <Spinner size={size()} />
          <Show when={props.text}>
            <span>{props.text}</span>
          </Show>
        </div>
      }
    >
      <div
        class={`flex flex-col items-center justify-center w-full h-full p-8 text-center animate-in fade-in duration-[var(--duration-slow)] ${
          props.class || ""
        }`}
      >
        <div class="flex flex-col items-center max-w-[280px]">
          <Spinner size={size()} class="mb-4 text-accent" />
          <Show when={props.text}>
            <p class="text-m font-semibold text-text-muted tracking-tight">
              {props.text}
            </p>
          </Show>
        </div>
      </div>
    </Show>
  );
}
