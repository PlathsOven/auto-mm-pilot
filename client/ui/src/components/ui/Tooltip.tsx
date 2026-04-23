import {
  Children,
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent as ReactFocusEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactElement,
  type ReactNode,
  type Ref,
} from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";

/**
 * Lightweight tooltip primitive for affordance hints.
 *
 * Wraps a single interactive child and shows a floating label on hover
 * (after `delayMs`) and on keyboard focus (immediately). Escape dismisses.
 * The tooltip renders into a portal on `document.body` so it escapes any
 * parent `overflow-hidden` or stacking context.
 *
 * API is minimal on purpose: `label`, optional `side`, optional `delayMs`.
 * Pass `disabled` to short-circuit when the same trigger is already used
 * for a richer popover (e.g. a node with its own hover card) so the two
 * don't fight.
 *
 * The child is cloned (React.cloneElement) so no extra DOM node is
 * inserted and refs pass through natively (React 19 ref-as-prop).
 */

const SHOW_DELAY_MS = 400;
const EDGE_MARGIN_PX = 8;
const GAP_PX = 6;

type Side = "top" | "bottom" | "left" | "right";

interface TooltipProps {
  label: ReactNode;
  children: ReactElement;
  side?: Side;
  delayMs?: number;
  /** When true, the tooltip is inert — passes the child through untouched. */
  disabled?: boolean;
}

interface ChildMergedProps {
  ref?: Ref<HTMLElement>;
  "aria-describedby"?: string;
  onMouseEnter?: (e: ReactMouseEvent<HTMLElement>) => void;
  onMouseLeave?: (e: ReactMouseEvent<HTMLElement>) => void;
  onFocus?: (e: ReactFocusEvent<HTMLElement>) => void;
  onBlur?: (e: ReactFocusEvent<HTMLElement>) => void;
}

export function Tooltip({
  label,
  children,
  side = "top",
  delayMs = SHOW_DELAY_MS,
  disabled = false,
}: TooltipProps) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const timerRef = useRef<number | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const tooltipId = useId();

  const clearTimer = useCallback(() => {
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const show = useCallback((el: HTMLElement, delay: number) => {
    clearTimer();
    const reveal = () => {
      setAnchor(el.getBoundingClientRect());
      setOpen(true);
    };
    if (delay === 0) {
      reveal();
    } else {
      timerRef.current = window.setTimeout(reveal, delay);
    }
  }, [clearTimer]);

  const hide = useCallback(() => {
    clearTimer();
    setOpen(false);
  }, [clearTimer]);

  useEffect(() => clearTimer, [clearTimer]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") hide();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, hide]);

  const child = isValidElement(children) ? Children.only(children) : null;

  if (disabled || child === null || label === undefined || label === null || label === "") {
    return <>{children}</>;
  }

  const childProps = (child.props ?? {}) as ChildMergedProps;

  const mergedRef: Ref<HTMLElement> = (el) => {
    triggerRef.current = el;
    const forwarded = (child as ReactElement & { ref?: Ref<HTMLElement> }).ref;
    if (typeof forwarded === "function") {
      forwarded(el);
    } else if (forwarded != null && typeof forwarded === "object") {
      (forwarded as { current: HTMLElement | null }).current = el;
    }
  };

  const mergedProps: ChildMergedProps = {
    ref: mergedRef,
    "aria-describedby": open ? tooltipId : childProps["aria-describedby"],
    onMouseEnter: (e) => {
      show(e.currentTarget, delayMs);
      childProps.onMouseEnter?.(e);
    },
    onMouseLeave: (e) => {
      hide();
      childProps.onMouseLeave?.(e);
    },
    onFocus: (e) => {
      // Keyboard focus bypasses the hover delay — the user is asking for it.
      show(e.currentTarget, 0);
      childProps.onFocus?.(e);
    },
    onBlur: (e) => {
      hide();
      childProps.onBlur?.(e);
    },
  };

  const cloned = cloneElement(child, mergedProps);

  return (
    <>
      {cloned}
      {anchor && typeof document !== "undefined"
        ? createPortal(
            <AnimatePresence>
              {open && (
                <motion.div
                  id={tooltipId}
                  role="tooltip"
                  initial={offsetEnter(side)}
                  animate={{ opacity: 1, scale: 1, x: 0, y: 0 }}
                  exit={offsetEnter(side)}
                  transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
                  style={computePosition(anchor, side)}
                  className="pointer-events-none fixed z-[9999] max-w-[240px] rounded-md bg-mm-text/92 px-2 py-1 text-[10px] font-medium leading-tight text-white shadow-elev-2 ring-1 ring-black/[0.12] backdrop-blur-sm"
                >
                  {label}
                </motion.div>
              )}
            </AnimatePresence>,
            document.body,
          )
        : null}
    </>
  );
}

function offsetEnter(side: Side) {
  const d = 4;
  switch (side) {
    case "top":
      return { opacity: 0, scale: 0.96, y: d, x: 0 };
    case "bottom":
      return { opacity: 0, scale: 0.96, y: -d, x: 0 };
    case "left":
      return { opacity: 0, scale: 0.96, y: 0, x: d };
    case "right":
      return { opacity: 0, scale: 0.96, y: 0, x: -d };
  }
}

function computePosition(rect: DOMRect, side: Side): CSSProperties {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let top: number;
  let left: number;
  let transform: string;

  switch (side) {
    case "top":
      top = rect.top - GAP_PX;
      left = rect.left + rect.width / 2;
      transform = "translate(-50%, -100%)";
      break;
    case "bottom":
      top = rect.bottom + GAP_PX;
      left = rect.left + rect.width / 2;
      transform = "translateX(-50%)";
      break;
    case "left":
      top = rect.top + rect.height / 2;
      left = rect.left - GAP_PX;
      transform = "translate(-100%, -50%)";
      break;
    case "right":
      top = rect.top + rect.height / 2;
      left = rect.right + GAP_PX;
      transform = "translateY(-50%)";
      break;
  }

  // Clamp the anchor inside the viewport so tooltips near a corner don't
  // drift off-screen. The translate() keeps the tooltip body visually
  // positioned relative to this anchor point.
  left = Math.max(EDGE_MARGIN_PX, Math.min(vw - EDGE_MARGIN_PX, left));
  top = Math.max(EDGE_MARGIN_PX, Math.min(vh - EDGE_MARGIN_PX, top));

  return { top, left, transform };
}
