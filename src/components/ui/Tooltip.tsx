import { createSignal, createEffect, onCleanup, Show } from "solid-js";
import { Portal } from "solid-js/web";
import type { JSX } from "solid-js";

interface Props {
  content: string;
  children: JSX.Element;
  delay?: number;
  placement?: "top" | "bottom" | "left" | "right";
  class?: string;
}

interface TooltipPos {
  top: number;
  left: number;
}

const OFFSET = 8;

function computePosition(
  anchor: DOMRect,
  tooltip: DOMRect,
  placement: "top" | "bottom" | "left" | "right",
): TooltipPos {
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  let top = 0;
  let left = 0;

  switch (placement) {
    case "top":
      top = anchor.top - tooltip.height - OFFSET;
      left = anchor.left + anchor.width / 2 - tooltip.width / 2;
      break;
    case "bottom":
      top = anchor.bottom + OFFSET;
      left = anchor.left + anchor.width / 2 - tooltip.width / 2;
      break;
    case "left":
      top = anchor.top + anchor.height / 2 - tooltip.height / 2;
      left = anchor.left - tooltip.width - OFFSET;
      break;
    case "right":
      top = anchor.top + anchor.height / 2 - tooltip.height / 2;
      left = anchor.right + OFFSET;
      break;
  }

  left = Math.max(6, Math.min(left, vw - tooltip.width - 6));
  top = Math.max(6, Math.min(top, vh - tooltip.height - 6));

  return { top, left };
}

export default function Tooltip(props: Props) {
  let wrapperRef: HTMLSpanElement | undefined;
  let tooltipRef: HTMLDivElement | undefined;
  const [visible, setVisible] = createSignal(false);
  const [pos, setPos] = createSignal<TooltipPos>({ top: 0, left: 0 });
  let timer: ReturnType<typeof setTimeout> | null = null;

  const delay = () => props.delay ?? 500;
  const placement = () => props.placement ?? "top";

  function show() {
    timer = setTimeout(() => setVisible(true), delay());
  }

  function hide() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    setVisible(false);
  }

  createEffect(() => {
    const content = props.content;
    const el = wrapperRef?.firstElementChild as HTMLElement | undefined;
    if (!el) return;
    const tag = el.tagName;
    const isControl =
      tag === "BUTTON" ||
      tag === "A" ||
      tag === "INPUT" ||
      el.getAttribute("role") === "button";
    if (!isControl) return;
    if (el.hasAttribute("aria-label") && !el.hasAttribute("data-tooltip-aria")) {
      return;
    }
    const text = (el.textContent || "").replace(/\s+/g, " ").trim();
    if (text) return;
    el.setAttribute("aria-label", content);
    el.setAttribute("data-tooltip-aria", "");
  });

  createEffect(() => {
    if (!visible()) return;
    const anchor = wrapperRef?.firstElementChild;
    if (!anchor || !tooltipRef) return;
    const anchorRect = anchor.getBoundingClientRect();
    const tooltipRect = tooltipRef.getBoundingClientRect();
    setPos(computePosition(anchorRect, tooltipRect, placement()));
  });

  onCleanup(() => {
    if (timer) clearTimeout(timer);
  });

  return (
    <>
      <span
        ref={wrapperRef}
        onMouseEnter={show}
        onMouseLeave={hide}
        onPointerDown={hide}
        onFocusIn={show}
        onFocusOut={hide}
        class={`inline-flex max-w-full ${props.class ?? ""}`}
      >
        {props.children}
      </span>
      <Show when={visible()}>
        <Portal mount={document.body}>
          <div
            ref={tooltipRef}
            class="tooltip"
            style={{ top: `${pos().top}px`, left: `${pos().left}px` }}
            role="tooltip"
          >
            {props.content}
          </div>
        </Portal>
      </Show>
    </>
  );
}
