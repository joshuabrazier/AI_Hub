"use client";

import { useEffect, useRef, useState } from "react";
import { useTheme } from "next-themes";
import { Sun, Moon, Monitor, type LucideIcon } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type ThemeOption = { value: string; label: string; icon: LucideIcon; hint: string };

const THEME_OPTIONS: ThemeOption[] = [
  { value: "light", label: "Light", icon: Sun, hint: "Always use the light theme" },
  { value: "dark", label: "Dark", icon: Moon, hint: "Always use the dark theme" },
  { value: "system", label: "System", icon: Monitor, hint: "Match your device setting" },
];

// -------------------------------------------------------------------
// Appearance settings - theme picker (Light / Dark / System).
// An accessible radiogroup with roving focus and arrow-key selection.
// -------------------------------------------------------------------
export function AppearanceSettings() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  // next-themes only knows the theme on the client; wait for mount so the
  // active option reflects the real setting rather than a hydration guess.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setMounted(true), []);

  const current = mounted ? (theme ?? "system") : undefined;

  const selectAt = (index: number) => {
    const option = THEME_OPTIONS[index];
    setTheme(option.value);
    refs.current[index]?.focus();
  };

  const handleKeyDown = (event: React.KeyboardEvent, index: number) => {
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      selectAt((index + 1) % THEME_OPTIONS.length);
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      selectAt((index - 1 + THEME_OPTIONS.length) % THEME_OPTIONS.length);
    }
  };

  return (
    <Card className="w-full">
      <CardHeader className="space-y-1">
        <CardTitle className="text-xl">Appearance</CardTitle>
        <CardDescription>Choose how the app looks. Your choice is saved on this device.</CardDescription>
      </CardHeader>

      <CardContent>
        <div role="radiogroup" aria-label="Theme" className="grid grid-cols-3 gap-3">
          {THEME_OPTIONS.map((option, index) => {
            const active = current === option.value;
            return (
              <button
                key={option.value}
                ref={(el) => {
                  refs.current[index] = el;
                }}
                type="button"
                role="radio"
                aria-checked={active}
                aria-label={`${option.label} - ${option.hint}`}
                // Roving tabindex: only the active option is tab-reachable.
                tabIndex={active || (current === undefined && index === 0) ? 0 : -1}
                onClick={() => setTheme(option.value)}
                onKeyDown={(e) => handleKeyDown(e, index)}
                className={cn(
                  "flex flex-col items-center gap-2 rounded-lg border p-4 text-sm font-medium transition-colors outline-none",
                  "focus-visible:ring-3 focus-visible:ring-ring/50",
                  active
                    ? "border-primary bg-primary/10 text-foreground ring-1 ring-primary/30"
                    : "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                <option.icon className="size-5" aria-hidden="true" />
                {option.label}
              </button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
