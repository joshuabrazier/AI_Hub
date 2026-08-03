"use client";

import { useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { Button } from "@/components/ui/button";
import { DataTable, type DataTableFacet, type DataTableSort, type DataTableToggle } from "@/components/data-table";
import { CreateEditDialogs, RowDialog } from "@/components/row-dialogs";
import { TableFilterNotice } from "@/components/table-filter-notice";
import { SESSION_STATUS_LABELS } from "@/lib/data/kysely-database-types";

import { SelectOption, SessionResponseDTO } from "../admin-sessions.types";
import { getSessionsColumns } from "./sessions-columns";
import { SessionFormDialog } from "./sessions-form-dialog";
import { SessionRosterDialog } from "./session-roster-dialog";

type Props = {
  sessions: SessionResponseDTO[];
  classOptions: SelectOption[];
};

// Date and time are both zero-padded strings, so this key sorts chronologically
// without turning either into a Date.
const dateKey = (session: SessionResponseDTO) => `${session.sessionDate} ${session.sessionStart}`;

// No-team sentinel for the Team facet (a facet value cannot be null).
const NO_TEAM = "no-team";

// First entry is the default order (chronological, matching the listing).
const SESSION_SORTS: DataTableSort<SessionResponseDTO>[] = [
  { id: "date-asc", label: "Date (earliest first)", compare: (a, b) => dateKey(a).localeCompare(dateKey(b)) },
  { id: "date-desc", label: "Date (latest first)", compare: (a, b) => dateKey(b).localeCompare(dateKey(a)) },
];

// Hoisted so the reference is stable across renders: passed inline these would
// be a new array/object every render, churning the table's filtered-data memo
// and bouncing it back to page 1 whenever a dialog opens.
const SESSION_SEARCH_KEYS: (keyof SessionResponseDTO & string)[] = [
  "className",
  "programName",
  "teamName",
  "status",
  "sessionDate",
];

const SESSION_ACTIVE_FILTER: DataTableToggle<SessionResponseDTO> = {
  predicate: (session) => session.classIsActive,
  label: "Active classes only",
};

export function SessionsTable({ sessions, classOptions }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [addOpen, setAddOpen] = useState(false);
  const [selectedSession, setSelectedSession] = useState<SessionResponseDTO | null>(null);
  const [rosterSession, setRosterSession] = useState<SessionResponseDTO | null>(null);

  // Scope to a single class when arriving from the Classes table's "Sessions"
  // action (?classId=...). This is a display filter over data the server
  // already scoped - it grants nothing.
  const classId = searchParams.get("classId");
  const shownSessions = useMemo(
    () => (classId ? sessions.filter((session) => session.classId === classId) : sessions),
    [sessions, classId],
  );
  const classLabel =
    classOptions.find((option) => option.value === classId)?.label ?? shownSessions[0]?.className ?? classId ?? "";

  // One facet per categorical column, built from the sessions shown.
  const facetFilters = useMemo<DataTableFacet<SessionResponseDTO>[]>(() => {
    const distinct = (pairs: [string, string][]) =>
      Array.from(new Map(pairs).entries())
        .map(([value, label]) => ({ value, label }))
        .sort((a, b) => a.label.localeCompare(b.label));

    const programs = distinct(shownSessions.map((session) => [session.programName, session.programName]));
    const classesOpts = distinct(shownSessions.map((session) => [session.classId, session.className]));
    const teams = distinct(shownSessions.map((session) => [session.teamId ?? NO_TEAM, session.teamName ?? "No team"]));
    const statuses = distinct(shownSessions.map((session) => [session.status, SESSION_STATUS_LABELS[session.status]]));

    return [
      { id: "program", label: "Program", options: programs, getValue: (session) => session.programName },
      { id: "class", label: "Class", options: classesOpts, getValue: (session) => session.classId },
      { id: "team", label: "Team", options: teams, getValue: (session) => session.teamId ?? NO_TEAM },
      { id: "status", label: "Status", options: statuses, getValue: (session) => session.status },
    ];
  }, [shownSessions]);

  const columns = getSessionsColumns({
    onEdit: (session) => setSelectedSession(session),
    onRoster: (session) => setRosterSession(session),
  });

  return (
    <div className="space-y-4">
      {classId && <TableFilterNotice label="Class" value={classLabel} onClear={() => router.push(pathname)} />}

      <DataTable
        columns={columns}
        data={shownSessions}
        searchPlaceholder="Search sessions..."
        searchKeys={SESSION_SEARCH_KEYS}
        toolbar={<Button onClick={() => setAddOpen(true)}>Add Session</Button>}
        activeFilter={SESSION_ACTIVE_FILTER}
        sortOptions={SESSION_SORTS}
        facetFilters={facetFilters}
        emptyMessage="No sessions yet. Sessions are created with a class, or add a one-off here."
      />

      <CreateEditDialogs
        createOpen={addOpen}
        onCreateOpenChange={setAddOpen}
        selected={selectedSession}
        onClearSelected={() => setSelectedSession(null)}
        render={(session, open, onOpenChange) => (
          <SessionFormDialog
            session={session}
            classOptions={classOptions}
            open={open}
            onOpenChange={onOpenChange}
          />
        )}
      />

      {/* Roster + attendance */}
      <RowDialog
        row={rosterSession}
        onClear={() => setRosterSession(null)}
        render={(session, open, onOpenChange) => (
          <SessionRosterDialog session={session} open={open} onOpenChange={onOpenChange} />
        )}
      />
    </div>
  );
}
