import { Show } from "solid-js";
import type { JSX } from "solid-js";

interface Props {
  icon?: JSX.Element;
  title?: JSX.Element;
  description?: JSX.Element;
  children?: JSX.Element;
}

export default function EmptyState(props: Props) {
  return (
    <div class="flex flex-col items-center justify-center w-full h-full p-8 text-center animate-in fade-in duration-[var(--duration-slow)]">
      <div class="flex flex-col items-center max-w-[280px]">
        <Show
          when={props.icon !== undefined}
          fallback={
            <img
              src="/favicon.png"
              alt="App Icon"
              class="w-16 h-16 object-contain mb-5 opacity-30 grayscale-[1] select-none pointer-events-none"
            />
          }
        >
          {props.icon}
        </Show>
        <div class="space-y-2">
          <Show when={props.title}>
            <h3 class="text-l font-semibold text-text/90 tracking-tight">{props.title}</h3>
          </Show>
          <Show when={props.description}>
            <div class="text-m text-text-muted font-medium leading-relaxed">{props.description}</div>
          </Show>
        </div>
        <Show when={props.children}>
          <div class="mt-6 w-full flex justify-center">{props.children}</div>
        </Show>
      </div>
    </div>
  );
}
