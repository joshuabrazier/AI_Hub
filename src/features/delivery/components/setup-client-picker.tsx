"use client";

import { useMemo, useState } from "react";
import { Check, ChevronsUpDown, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

import { CLIENT_NAME_MAX_CHARS, type ClientOptionDTO, type ProjectClientRequestDTO } from "../delivery.types";

// -------------------------------------------------------------------
// THE CLIENT ON A NEW PROJECT: picked, or typed.
//
// The value is ProjectClientSchema's own discriminated union, not a pair of
// optional fields, so "picked one" and "typed a new name" cannot both be
// half-set. This control knows which row was clicked, which is exactly what
// that union asks the form to carry.
//
// WHAT THE SERVER DOES WITH A TYPED NAME, and why the control is shaped
// around it: createProjectService RESOLVES a typed name onto the client that
// already holds it rather than failing on the unique index - "Perks already
// exists" is not an error to somebody who just wants the project made. That
// is right, and it is also the one way this control could mislead: somebody
// typing a name they believe is new, and quietly getting an existing
// client's history attached to their project.
//
// So reuse is made DELIBERATE here rather than accidental. Matching is done
// the way the database matches - trimmed, ignoring capitals, EXACT, with no
// prefix or fuzzy fallback, because attaching a project to a similarly named
// client is worse than a duplicate an admin can see. When the typed name
// already belongs to a client, the create row is REPLACED by a sentence
// saying so, and the only way forward is to pick that client: the same
// outcome the server would have reached, chosen instead of discovered.
//
// It is a hint, never a check. The server re-reads through the index's own
// predicate and is the only thing that decides - this cannot see a client
// created a second ago in another tab, and a retired client holding the name
// is not in this list at all (the picker is offered active clients only) and
// is refused there in a sentence naming it.
// -------------------------------------------------------------------

// Enough rows to scan, with the search to narrow the rest. The same ceiling
// FormComboboxField uses.
const MAX_VISIBLE = 50;

const normalise = (name: string) => name.trim().toLowerCase();

// -------------------------------------------------------------------
// The client a typed name ALREADY belongs to, if any.
//
// Exported and tested directly, because the interesting part is what it
// REFUSES to match: this is the rule that decides whether somebody is
// offered "create Perks" or told that Perks exists, and a near miss
// silently counting as a hit would attach a project to the wrong client's
// history. Trimmed and case-insensitive because that is what
// `idx_clients_name_unique` compares - lower(btrim(name)) - and EXACT
// because the server has no fuzzy fallback either.
// -------------------------------------------------------------------
export function findClientByTypedName(
  clients: readonly ClientOptionDTO[],
  typed: string,
): ClientOptionDTO | undefined {
  const needle = normalise(typed);

  if (!needle) return undefined;

  return clients.find((client) => normalise(client.name) === needle);
}

type Props = {
  id: string;
  clients: readonly ClientOptionDTO[];
  value: ProjectClientRequestDTO | null;
  onChange: (value: ProjectClientRequestDTO) => void;
  invalid?: boolean;
  describedBy?: string;
  disabled?: boolean;
};

export function SetupClientPicker({ id, clients, value, onChange, invalid, describedBy, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const typed = query.trim().slice(0, CLIENT_NAME_MAX_CHARS);

  const filtered = useMemo(() => {
    const needle = normalise(query);

    if (!needle) return clients;

    return clients.filter((client) => normalise(client.name).includes(needle));
  }, [clients, query]);

  // The client whose name IS what was typed, if there is one. This is what
  // turns "create it" into "you meant this one".
  const exactMatch = useMemo(() => findClientByTypedName(clients, typed), [clients, typed]);

  const visible = filtered.slice(0, MAX_VISIBLE);
  const hiddenCount = filtered.length - visible.length;

  const selectedClient =
    value?.mode === "existing" ? clients.find((client) => client.id === value.clientId) : undefined;

  const triggerLabel =
    value === null
      ? "Choose a client, or type a new name"
      : value.mode === "new"
        ? `New client: ${value.name}`
        : (selectedClient?.name ?? "Choose a client, or type a new name");

  const choose = (next: ProjectClientRequestDTO) => {
    onChange(next);
    setOpen(false);
  };

  return (
    <div className="grid gap-2">
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (next) setQuery("");
        }}
      >
        <PopoverTrigger asChild>
          <Button
            type="button"
            id={id}
            variant="outline"
            role="combobox"
            aria-expanded={open}
            aria-invalid={invalid}
            aria-describedby={describedBy}
            disabled={disabled}
            className={cn("w-full justify-between font-normal", value === null && "text-muted-foreground")}
          >
            <span className="truncate">{triggerLabel}</span>
            <ChevronsUpDown size={16} className="shrink-0 opacity-50" aria-hidden="true" />
          </Button>
        </PopoverTrigger>

        <PopoverContent align="start" portal={false} className="w-(--radix-popover-trigger-width) p-0">
          <div className="border-b p-2">
            <Input
              autoFocus
              value={query}
              maxLength={CLIENT_NAME_MAX_CHARS}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search, or type a new client name"
              aria-label="Search clients, or type a new client name"
            />
          </div>

          <ul className="max-h-64 overflow-y-auto p-1" role="listbox">
            {visible.length === 0 && !typed && (
              <li className="px-2 py-6 text-center text-sm text-muted-foreground">
                No clients yet. Type a name to create the first one.
              </li>
            )}

            {visible.map((client) => {
              const isSelected = value?.mode === "existing" && value.clientId === client.id;

              return (
                <li key={client.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => choose({ mode: "existing", clientId: client.id })}
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
                    {/* Typed by somebody, so it renders as a text node. */}
                    <span className="truncate">{client.name}</span>
                  </button>
                </li>
              );
            })}

            {hiddenCount > 0 && (
              <li className="px-2 py-2 text-center text-xs text-muted-foreground">
                {hiddenCount} more. Keep typing to narrow it down.
              </li>
            )}

            {/* The create row, and the sentence that replaces it. Only ever
                one of the two: offering "create Perks" beside the Perks that
                already exists is how the second one gets made. */}
            {typed && !exactMatch && (
              <li className="border-t border-border pt-1">
                <button
                  type="button"
                  onClick={() => choose({ mode: "new", name: typed })}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none hover:bg-muted focus-visible:bg-muted"
                >
                  <Plus size={16} className="shrink-0" aria-hidden="true" />
                  <span className="truncate">Create client &quot;{typed}&quot;</span>
                </button>
              </li>
            )}

            {typed && exactMatch && (
              <li className="border-t border-border px-2 py-2 text-xs text-muted-foreground">
                {exactMatch.name} already exists. Choose it above to start this project for them.
              </li>
            )}
          </ul>
        </PopoverContent>
      </Popover>

      {value?.mode === "new" && (
        // Said on the way in rather than found out afterwards.
        <p className="text-sm text-muted-foreground">
          {value.name} will be created as a new client. If a client of that name already exists, this project is
          attached to that one instead of a second being made.
        </p>
      )}
    </div>
  );
}
