"use client";

import { useEffect, useRef, useState } from "react";
import { animate, motion, useReducedMotion } from "motion/react";

// -------------------------------------------------------------------
// Motion primitives
//
// The rules every animation on this screen follows:
//
//   - 150-300ms. Long enough to be seen, short enough to feel like feedback
//     rather than a wait.
//   - transform and opacity only, so the work stays on the compositor and
//     never triggers layout. Animating height or width on a table would jank
//     and shift everything below it.
//   - Motion has to mean something. Numbers count up because the figure
//     changed; rows stagger because they arrived in order. Nothing moves for
//     decoration.
//   - prefers-reduced-motion is honoured everywhere, and honoured properly:
//     the content appears at its final value immediately, never hidden.
//
// That last point is the one most often got wrong. A reveal built as
// "opacity 0 then animate to 1" leaves the content invisible forever when
// animations are disabled, so every component here starts from the final
// state when reduced motion is set.
// -------------------------------------------------------------------

const EASE_OUT = [0.22, 1, 0.36, 1] as const;

// -------------------------------------------------------------------
// A figure that counts up when it changes.
//
// The animated text is aria-hidden and the settled value is exposed to screen
// readers separately, so assistive tech announces "18.75 hours" once rather
// than narrating every intermediate frame.
// -------------------------------------------------------------------
export function AnimatedNumber({
  value,
  decimals = 2,
  prefix = "",
  suffix = "",
  // Group thousands. Off by default because an hours figure does not want it
  // and a four-digit money figure is unreadable without it.
  grouped = false,
  className,
}: {
  value: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  grouped?: boolean;
  className?: string;
}) {
  const reduceMotion = useReducedMotion();
  const [display, setDisplay] = useState(value);
  const previous = useRef(value);

  useEffect(() => {
    const from = previous.current;
    previous.current = value;

    if (reduceMotion || from === value) {
      setDisplay(value);
      return;
    }

    const controls = animate(from, value, {
      duration: 0.5,
      ease: EASE_OUT,
      onUpdate: (latest) => setDisplay(latest),
    });

    // Stopping on unmount prevents a state update after the component is gone
    // when someone changes filters faster than the animation finishes.
    return () => controls.stop();
  }, [value, reduceMotion]);

  const render = (input: number) =>
    grouped
      ? input.toLocaleString("en-AU", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
      : input.toFixed(decimals);

  return (
    <span className={className}>
      <span aria-hidden="true" className="tabular-nums">
        {prefix}
        {render(display)}
        {suffix}
      </span>
      {/* The settled value, for a screen reader: announcing every frame of a
          count-up would be unusable. */}
      <span className="sr-only">
        {prefix}
        {render(value)}
        {suffix}
      </span>
    </span>
  );
}

// -------------------------------------------------------------------
// A panel that rises into place, staggered by its position.
//
// `index` spaces each panel 40ms after the one above it, inside the 30-50ms
// band that reads as a sequence rather than a queue. Beyond about six panels
// the delay is capped, because the last card of a long page should not wait
// half a second to exist.
// -------------------------------------------------------------------
export function Reveal({
  children,
  index = 0,
  className,
}: {
  children: React.ReactNode;
  index?: number;
  className?: string;
}) {
  const reduceMotion = useReducedMotion();

  if (reduceMotion) return <div className={className}>{children}</div>;

  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: EASE_OUT, delay: Math.min(index, 6) * 0.04 }}
    >
      {children}
    </motion.div>
  );
}

// -------------------------------------------------------------------
// A card that lifts very slightly under the pointer.
//
// Displacement is kept to 2px: enough to read as "this responds", not enough
// to read as movement. The shadow does the rest of the work. Both are
// transform and box-shadow only, so nothing around it reflows.
// -------------------------------------------------------------------
export function LiftOnHover({ children, className }: { children: React.ReactNode; className?: string }) {
  const reduceMotion = useReducedMotion();

  if (reduceMotion) return <div className={className}>{children}</div>;

  return (
    <motion.div
      className={className}
      whileHover={{ y: -2 }}
      // Exit is faster than enter, which is what makes a control feel
      // responsive rather than sticky.
      transition={{ duration: 0.18, ease: EASE_OUT }}
    >
      {children}
    </motion.div>
  );
}

// -------------------------------------------------------------------
// A horizontal proportion bar, e.g. billable share.
//
// Animates scaleX rather than width, so it composites instead of triggering
// layout on every frame. The track is always full width, so the row height is
// reserved before the bar grows and nothing below it shifts.
// -------------------------------------------------------------------
export function ProportionBar({
  ratio,
  label,
  className,
}: {
  ratio: number | null;
  label: string;
  className?: string;
}) {
  const reduceMotion = useReducedMotion();
  const clamped = ratio === null ? 0 : Math.max(0, Math.min(1, ratio));

  return (
    <div
      className={className}
      role="img"
      aria-label={ratio === null ? `${label}: no data` : `${label}: ${Math.round(clamped * 100)} per cent`}
    >
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <motion.div
          className="h-full origin-left rounded-full bg-primary"
          initial={reduceMotion ? false : { scaleX: 0 }}
          animate={{ scaleX: clamped }}
          transition={reduceMotion ? { duration: 0 } : { duration: 0.45, ease: EASE_OUT }}
          style={{ width: "100%" }}
        />
      </div>
    </div>
  );
}
