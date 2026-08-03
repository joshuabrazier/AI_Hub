"use client";

import { useState } from "react";
import { Check, ChevronDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  LANDING_ICONS,
  LANDING_ICON_NAMES,
  type LandingIconName,
} from "@/features/site-content/landing-content.types";
import { cn } from "@/lib/utils";

// -------------------------------------------------------------------
// Landing icon picker
//
// Driven entirely by LANDING_ICONS, which is the closed map the public page
// resolves a stored name through. Adding an icon there makes it appear here -
// there is no second list to keep in step, and nothing outside that map can be
// chosen, so an admin cannot save a name the page would fall back on.
//
// The icons are shown, not named: "gauge" versus "compass" is not a decision
// anyone can make from the word alone.
// -------------------------------------------------------------------

/** "barChart" reads as "Bar chart" - the camelCase key is not a label. */
export function landingIconLabel(name: string): string {
  const spaced = name.replace(/([A-Z])/g, " $1").toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function LandingIconPicker({
  id,
  label,
  value,
  onChange,
  disabled,
}: {
  id: string;
  label: string;
  value: LandingIconName;
  onChange: (icon: LandingIconName) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const SelectedIcon = LANDING_ICONS[value] ?? LANDING_ICONS.sparkles;

  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id={id}
            type="button"
            variant="outline"
            size="lg"
            disabled={disabled}
            className="w-full justify-between font-normal"
          >
            <span className="flex items-center gap-2">
              <SelectedIcon className="size-4 text-signal" aria-hidden="true" />
              <span>{landingIconLabel(value)}</span>
            </span>
            <ChevronDown className="size-4 text-muted-foreground" aria-hidden="true" />
          </Button>
        </PopoverTrigger>

        <PopoverContent align="start" className="w-64 p-2">
          <div className="grid grid-cols-5 gap-1" role="listbox" aria-label={label}>
            {LANDING_ICON_NAMES.map((name) => {
              const Icon = LANDING_ICONS[name];
              const isSelected = name === value;

              return (
                <button
                  key={name}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  title={landingIconLabel(name)}
                  onClick={() => {
                    onChange(name);
                    setOpen(false);
                  }}
                  className={cn(
                    "relative flex size-10 items-center justify-center rounded-lg border border-transparent text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
                    isSelected && "border-primary/40 bg-primary/10 text-primary",
                  )}
                >
                  <Icon className="size-5" aria-hidden="true" />
                  <span className="sr-only">{landingIconLabel(name)}</span>
                  {isSelected && (
                    <Check className="absolute right-0.5 bottom-0.5 size-3 text-primary" aria-hidden="true" />
                  )}
                </button>
              );
            })}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
