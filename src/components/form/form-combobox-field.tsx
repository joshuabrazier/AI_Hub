"use client";

import * as React from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Controller, type Control, type FieldPath, type FieldValues } from "react-hook-form";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

type ComboboxOption<TValue extends string = string> = {
  value: TValue;
  label: string;
};

type FormComboboxFieldProps<TFieldValues extends FieldValues, TValue extends string = string> = {
  control: Control<TFieldValues>;
  name: FieldPath<TFieldValues>;
  label: string;
  options: readonly ComboboxOption<TValue>[];
  placeholder?: string;
  searchPlaceholder?: string;
  description?: string;
  disabled?: boolean;
  id?: string;
  className?: string;
};

// How many matches to render at once — keeps the list snappy even with
// hundreds/thousands of options; the search narrows it down.
const MAX_VISIBLE = 50;

// -------------------------------------------------------------------
// FormComboboxField
// A searchable single-select for react-hook-form. Same API as
// FormSelectField, but the options are filtered by a search box — use it
// instead of a plain select when the list is long (e.g. hundreds of clients).
// -------------------------------------------------------------------
export function FormComboboxField<TFieldValues extends FieldValues, TValue extends string = string>({
  control,
  name,
  label,
  options,
  placeholder = "Select an option",
  searchPlaceholder = "Search…",
  description,
  disabled,
  id,
  className,
}: FormComboboxFieldProps<TFieldValues, TValue>) {
  const inputId = id ?? String(name);
  const descriptionId = description ? `${inputId}-description` : undefined;
  const errorId = `${inputId}-error`;
  const ariaDescribedBy = [descriptionId, errorId].filter(Boolean).join(" ");

  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((option) => option.label.toLowerCase().includes(q));
  }, [options, query]);

  const visible = filtered.slice(0, MAX_VISIBLE);
  const hiddenCount = filtered.length - visible.length;

  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => {
        const selected = options.find((option) => option.value === field.value);

        return (
          <div className="grid gap-2">
            <Label htmlFor={inputId}>{label}</Label>

            <Popover
              open={open}
              onOpenChange={(next) => {
                setOpen(next);
                if (next) setQuery("");
                else field.onBlur();
              }}
            >
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  id={inputId}
                  variant="outline"
                  role="combobox"
                  aria-expanded={open}
                  aria-invalid={fieldState.invalid}
                  aria-describedby={ariaDescribedBy || undefined}
                  disabled={disabled}
                  className={cn("w-full justify-between font-normal", !selected && "text-muted-foreground", className)}
                >
                  <span className="truncate">{selected ? selected.label : placeholder}</span>
                  <ChevronsUpDown size={16} className="shrink-0 opacity-50" aria-hidden="true" />
                </Button>
              </PopoverTrigger>

              <PopoverContent align="start" portal={false} className="w-(--radix-popover-trigger-width) p-0">
                <div className="border-b p-2">
                  <Input
                    autoFocus
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder={searchPlaceholder}
                    aria-label={searchPlaceholder}
                  />
                </div>

                <ul className="max-h-64 overflow-y-auto p-1" role="listbox">
                  {visible.length === 0 ? (
                    <li className="px-2 py-6 text-center text-sm text-muted-foreground">No matches.</li>
                  ) : (
                    visible.map((option) => {
                      const isSelected = option.value === field.value;
                      return (
                        <li key={option.value}>
                          <button
                            type="button"
                            role="option"
                            aria-selected={isSelected}
                            onClick={() => {
                              field.onChange(option.value);
                              setOpen(false);
                            }}
                            className={cn(
                              "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none hover:bg-muted focus-visible:bg-muted",
                              isSelected && "bg-muted/60",
                            )}
                          >
                            <Check
                              size={16}
                              className={cn("shrink-0", isSelected ? "opacity-100" : "opacity-0")}
                              aria-hidden="true"
                            />
                            <span className="truncate">{option.label}</span>
                          </button>
                        </li>
                      );
                    })
                  )}
                  {hiddenCount > 0 && (
                    <li className="px-2 py-2 text-center text-xs text-muted-foreground">
                      {hiddenCount} more — keep typing to narrow it down.
                    </li>
                  )}
                </ul>
              </PopoverContent>
            </Popover>

            {description && (
              <p id={descriptionId} className="text-sm text-muted-foreground">
                {description}
              </p>
            )}

            {fieldState.error && (
              <p id={errorId} className="text-sm text-destructive">
                {fieldState.error.message}
              </p>
            )}
          </div>
        );
      }}
    />
  );
}
