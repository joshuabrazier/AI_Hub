"use client";

import * as React from "react";
import { Clock } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

const ITEM_HEIGHT = 36; // px per wheel row
const VISIBLE_ROWS = 5; // odd, so one row sits in the centre
const CENTER_OFFSET = ((VISIBLE_ROWS - 1) / 2) * ITEM_HEIGHT;
const WHEEL_STEP = 50; // wheel delta accumulated before advancing one row

type Period = "AM" | "PM";

const HOURS = Array.from({ length: 12 }, (_, i) => i + 1); // 1..12
const MINUTES = Array.from({ length: 60 }, (_, i) => i); // 0..59
const PERIODS: Period[] = ["AM", "PM"];

// 'HH:MM' (24h) → parts, or null if unparseable.
function parseTime(value: string): { hour12: number; minute: number; period: Period } | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const h = Number(match[1]);
  return { hour12: h % 12 === 0 ? 12 : h % 12, minute: Number(match[2]), period: h < 12 ? "AM" : "PM" };
}

function toValue(hour12: number, minute: number, period: Period): string {
  const h = (hour12 % 12) + (period === "PM" ? 12 : 0);
  return `${String(h).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function formatLabel(value: string): string {
  const parsed = parseTime(value);
  if (!parsed) return "Select time";
  return `${parsed.hour12}:${String(parsed.minute).padStart(2, "0")} ${parsed.period}`;
}

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

// -------------------------------------------------------------------
// A fully-controlled wheel column. The list is moved by a CSS transform;
// mouse-wheel, drag, and click all change the centred item. No native
// scrolling (which snap-scroll made unreliable).
// -------------------------------------------------------------------
function WheelColumn<T extends string | number>({
  items,
  value,
  onChange,
  format,
  ariaLabel,
}: {
  items: readonly T[];
  value: T;
  onChange: (item: T) => void;
  format: (item: T) => string;
  ariaLabel: string;
}) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const baseId = React.useId();
  const index = Math.max(0, items.indexOf(value));

  // Latest index/onChange for the non-passive wheel listener (attached once).
  const indexRef = React.useRef(index);
  const onChangeRef = React.useRef(onChange);
  const accumRef = React.useRef(0);
  React.useEffect(() => {
    indexRef.current = index;
    onChangeRef.current = onChange;
  });

  const moveTo = React.useCallback(
    (next: number) => {
      const clamped = clamp(next, 0, items.length - 1);
      if (clamped !== indexRef.current) onChangeRef.current(items[clamped]);
    },
    [items],
  );

  // Wheel: accumulate delta so both mouse notches and trackpads feel right.
  React.useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      // Normalise line/page deltas to a step's worth, accumulate, then move at
      // most ONE row per wheel event - so a single mouse notch (deltaY ~100)
      // advances one row instead of two.
      const unit = event.deltaMode === 0 ? 1 : WHEEL_STEP;
      accumRef.current += event.deltaY * unit;
      if (Math.abs(accumRef.current) >= WHEEL_STEP) {
        moveTo(indexRef.current + Math.sign(accumRef.current));
        accumRef.current = 0;
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [moveTo]);

  // Pointer: drag to spin, or tap a row to pick it. We capture the pointer on
  // down so the matching up always lands here (a plain click otherwise gets
  // swallowed by the capture and never selects), and tell a tap from a drag by
  // whether the pointer actually moved a row.
  const drag = React.useRef<{ startY: number; startIndex: number; moved: boolean } | null>(null);
  const onPointerDown = (event: React.PointerEvent) => {
    drag.current = { startY: event.clientY, startIndex: index, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: React.PointerEvent) => {
    const state = drag.current;
    if (!state) return;
    const steps = Math.round((state.startY - event.clientY) / ITEM_HEIGHT);
    if (steps !== 0) state.moved = true;
    moveTo(state.startIndex + steps);
  };
  const onPointerUp = (event: React.PointerEvent) => {
    const state = drag.current;
    drag.current = null;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // pointer already released
    }
    if (!state || state.moved) return;
    // A tap (no drag): select whichever row sits under the pointer.
    const rect = event.currentTarget.getBoundingClientRect();
    const localY = event.clientY - rect.top;
    const offset = CENTER_OFFSET - indexRef.current * ITEM_HEIGHT;
    moveTo(Math.floor((localY - offset) / ITEM_HEIGHT));
  };

  // Keyboard: arrow keys nudge one row, Page/Home/End jump further.
  const onKeyDown = (event: React.KeyboardEvent) => {
    switch (event.key) {
      case "ArrowUp":
      case "ArrowLeft":
        moveTo(index - 1);
        break;
      case "ArrowDown":
      case "ArrowRight":
        moveTo(index + 1);
        break;
      case "PageUp":
        moveTo(index - 3);
        break;
      case "PageDown":
        moveTo(index + 3);
        break;
      case "Home":
        moveTo(0);
        break;
      case "End":
        moveTo(items.length - 1);
        break;
      default:
        return;
    }
    event.preventDefault();
  };

  return (
    <div
      ref={containerRef}
      role="listbox"
      aria-label={ariaLabel}
      aria-activedescendant={`${baseId}-${index}`}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={onKeyDown}
      className="relative w-14 cursor-pointer touch-none overflow-hidden rounded-lg outline-none select-none focus-visible:ring-2 focus-visible:ring-ring/50"
      style={{ height: VISIBLE_ROWS * ITEM_HEIGHT }}
    >
      <div
        className="transition-transform duration-150 ease-out will-change-transform"
        style={{ transform: `translateY(${CENTER_OFFSET - index * ITEM_HEIGHT}px)` }}
      >
        {items.map((item, i) => {
          const distance = Math.abs(i - index);
          return (
            <div
              key={String(item)}
              id={`${baseId}-${i}`}
              role="option"
              aria-selected={i === index}
              className={cn(
                "flex items-center justify-center tabular-nums transition-colors",
                i === index ? "text-base font-semibold text-foreground" : "text-sm text-muted-foreground",
              )}
              style={{ height: ITEM_HEIGHT, opacity: i === index ? 1 : Math.max(0.2, 1 - distance * 0.26) }}
            >
              {format(item)}
            </div>
          );
        })}
      </div>
    </div>
  );
}

type Props = {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  invalid?: boolean;
  className?: string;
  "aria-label"?: string;
};

// A wheel-style time picker in a popover (hour / minute / AM-PM) with
// Cancel + Save. Values are 'HH:MM' (24h).
export function TimeSelect({ value, onChange, disabled, invalid, className, ...rest }: Props) {
  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState(
    () => parseTime(value) ?? { hour12: 12, minute: 0, period: "AM" as Period },
  );

  const handleOpenChange = (next: boolean) => {
    if (next) setDraft(parseTime(value) ?? { hour12: 12, minute: 0, period: "AM" });
    setOpen(next);
  };

  const save = () => {
    onChange(toValue(draft.hour12, draft.minute, draft.period));
    setOpen(false);
  };

  const label = rest["aria-label"];

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label={label}
          className={cn(
            "inline-flex h-9 items-center justify-between gap-2 rounded-lg border border-input bg-background px-3 text-sm whitespace-nowrap transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30 dark:hover:bg-input/50",
            invalid && "border-destructive ring-3 ring-destructive/20",
            className,
          )}
        >
          <span className={cn(!parseTime(value) && "text-muted-foreground")}>{formatLabel(value)}</span>
          <Clock className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        </button>
      </PopoverTrigger>

      <PopoverContent align="start" className="w-auto">
        <p className="border-b px-3 py-2 text-center text-sm font-medium">Select time</p>

        <div className="relative px-3 py-2">
          {/* Centre selection highlight */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-3 top-1/2 h-9 -translate-y-1/2 rounded-lg bg-muted"
          />
          <div className="relative flex items-stretch justify-center gap-1">
            <WheelColumn
              items={HOURS}
              value={draft.hour12}
              format={(h) => String(h).padStart(2, "0")}
              onChange={(h) => setDraft((d) => ({ ...d, hour12: h }))}
              ariaLabel={label ? `${label} hour` : "Hour"}
            />
            <span className="flex w-2 items-center justify-center self-center text-muted-foreground">:</span>
            <WheelColumn
              items={MINUTES}
              value={draft.minute}
              format={(m) => String(m).padStart(2, "0")}
              onChange={(m) => setDraft((d) => ({ ...d, minute: m }))}
              ariaLabel={label ? `${label} minute` : "Minute"}
            />
            <WheelColumn
              items={PERIODS}
              value={draft.period}
              format={(p) => p}
              onChange={(p) => setDraft((d) => ({ ...d, period: p }))}
              ariaLabel={label ? `${label} AM or PM` : "AM or PM"}
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t p-2">
          <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button type="button" size="sm" onClick={save}>
            Save
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
