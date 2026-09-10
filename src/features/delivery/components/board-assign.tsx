"use client";

import { Check, UserRound } from "lucide-react";

import { DropdownMenuItem } from "@/components/ui/dropdown-menu";

import { memberLabel, type ProjectMemberDTO } from "../delivery.types";

// -------------------------------------------------------------------
// ===================================================================
// PUTTING SOMEBODY'S NAME ON A TASK
// ===================================================================
//
// Assignment was reachable from exactly one place: open a card, find the
// Description section, and press a button labelled "Edit" that sits beside
// that heading. It edits the whole task, but nothing about where it sits
// says so, and "Unassigned" on the card was plain text with no affordance on
// it at all. So the ordinary answer to "who is doing this" was three clicks
// behind a control that looks like it is about something else.
//
// These are the menu items, shared by the two places that now offer it - the
// card's own menu on the board, and the assignee row in the task panel - so
// the list, the ordering and the labels cannot come to differ between them.
//
// UNASSIGNED IS FIRST AND IS ALWAYS OFFERED. Taking a name off is as ordinary
// as putting one on, and a menu that can only add is one people work around
// by assigning the wrong person.
//
// ONLY PROJECT MEMBERS. The list is the project's own membership, which is
// also what the service enforces - `assigneeId` is checked against
// project_members on the way in, so a stale menu cannot assign somebody who
// has since been taken off. This list decides what is OFFERED and never what
// is allowed.
// -------------------------------------------------------------------

export function AssigneeMenuItems({
  members,
  assigneeId,
  onAssign,
}: {
  members: readonly ProjectMemberDTO[];
  /** Who holds it now, so the current choice is ticked. */
  assigneeId: string | null;
  onAssign: (assigneeId: string | null) => void;
}) {
  return (
    <>
      <DropdownMenuItem onSelect={() => onAssign(null)}>
        <Check
          size={14}
          aria-hidden="true"
          // Kept in the layout rather than removed, so the labels line up
          // whether or not a row is the current one.
          className={assigneeId === null ? "opacity-100" : "opacity-0"}
        />
        Unassigned
      </DropdownMenuItem>

      {members.length === 0 ? (
        // A project with no members yet. Said in words rather than as an
        // empty menu, which reads as broken.
        <DropdownMenuItem disabled>
          <UserRound size={14} aria-hidden="true" />
          Nobody is on this project yet
        </DropdownMenuItem>
      ) : (
        members.map((member) => (
          <DropdownMenuItem key={member.userId} onSelect={() => onAssign(member.userId)}>
            <Check
              size={14}
              aria-hidden="true"
              className={assigneeId === member.userId ? "opacity-100" : "opacity-0"}
            />
            {/* Typed by a person, or their address. A text node. */}
            {memberLabel(member)}
          </DropdownMenuItem>
        ))
      )}
    </>
  );
}
