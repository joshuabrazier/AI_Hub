"use client";

import { useMemo, useState } from "react";

import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type PickerOption = { id: string; label: string; sublabel: string | null };

// -------------------------------------------------------------------
// A scrollable, optionally-searchable checkbox list for multi-selecting
// records by id (e.g. notification recipients, members to add). Search
// matches the label and sublabel.
// -------------------------------------------------------------------
export function CheckboxPicker({
  idPrefix,
  options,
  selected,
  onToggle,
  searchable,
  emptyMessage,
  disabled,
}: {
  idPrefix: string;
  options: PickerOption[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  searchable?: boolean;
  emptyMessage: string;
  disabled?: boolean;
}) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) return options;
    return options.filter(
      (option) =>
        option.label.toLowerCase().includes(trimmed) || (option.sublabel?.toLowerCase().includes(trimmed) ?? false),
    );
  }, [options, query]);

  return (
    <div className="space-y-2">
      {searchable && options.length > 0 && (
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search…"
          disabled={disabled}
          aria-label="Filter list"
        />
      )}
      <div className="max-h-48 overflow-y-auto rounded-md border border-border">
        {options.length === 0 ? (
          <p className="p-3 text-sm text-muted-foreground">{emptyMessage}</p>
        ) : filtered.length === 0 ? (
          <p className="p-3 text-sm text-muted-foreground">No matches.</p>
        ) : (
          <ul>
            {filtered.map((option) => {
              const id = `${idPrefix}-${option.id}`;
              return (
                <li key={option.id} className="border-b border-border last:border-b-0">
                  <Label
                    htmlFor={id}
                    className="flex cursor-pointer items-center gap-3 px-3 py-2 font-normal hover:bg-muted"
                  >
                    <Checkbox
                      id={id}
                      checked={selected.has(option.id)}
                      onCheckedChange={() => onToggle(option.id)}
                      disabled={disabled}
                    />
                    <span className="min-w-0">
                      <span className="block truncate text-sm text-foreground">{option.label}</span>
                      {option.sublabel && (
                        <span className="block truncate text-xs text-muted-foreground">{option.sublabel}</span>
                      )}
                    </span>
                  </Label>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
