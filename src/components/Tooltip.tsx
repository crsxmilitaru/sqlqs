import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

interface Props {
  content: string;
  children: React.ReactElement;
  delay?: number;
  placement?: "top" | "bottom" | "left" | "right";
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

export default function Tooltip({ content, children, delay = 500, placement = "top" }: Props) {
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState<TooltipPos>({ top: 0, left: 0 });
  const anchorRef = useRef<HTMLElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback(() => {
    timerRef.current = setTimeout(() => {
      setVisible(true);
    }, delay);
  }, [delay]);

  const hide = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setVisible(false);
  }, []);

  useEffect(() => {
    if (!visible || !anchorRef.current || !tooltipRef.current) return;
    const anchorRect = anchorRef.current.getBoundingClientRect();
    const tooltipRect = tooltipRef.current.getBoundingClientRect();
    setPos(computePosition(anchorRect, tooltipRect, placement));
  }, [visible, placement]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const child = children as React.ReactElement<React.HTMLAttributes<HTMLElement>>;

  const cloned = {
    ...child,
    props: {
      ...child.props,
      ref: (el: HTMLElement | null) => {
        anchorRef.current = el;
        const originalRef = (child as any).ref;
        if (typeof originalRef === "function") originalRef(el);
        else if (originalRef && "current" in originalRef) originalRef.current = el;
      },
      onMouseEnter: (e: React.MouseEvent<HTMLElement>) => {
        show();
        child.props.onMouseEnter?.(e);
      },
      onMouseLeave: (e: React.MouseEvent<HTMLElement>) => {
        hide();
        child.props.onMouseLeave?.(e);
      },
      onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
        hide();
        (child.props as any).onPointerDown?.(e);
      },
      onFocus: (e: React.FocusEvent<HTMLElement>) => {
        show();
        child.props.onFocus?.(e);
      },
      onBlur: (e: React.FocusEvent<HTMLElement>) => {
        hide();
        child.props.onBlur?.(e);
      },
    },
  };

  return (
    <>
      {cloned}
      {visible &&
        createPortal(
          <div
            ref={tooltipRef}
            className="tooltip"
            style={{ top: pos.top, left: pos.left }}
            role="tooltip"
          >
            {content}
          </div>,
          document.body
        )}
    </>
  );
}
