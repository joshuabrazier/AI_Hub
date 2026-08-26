import "server-only";

import { type UserRole, USER_ROLES, USER_ROLE_LABELS } from "@/lib/data/kysely-database-types";
import { isCollapsible, navGroupsForRole } from "@/features/layout/nav-items";

// -------------------------------------------------------------------
// What the assistant knows about the app it lives in.
//
// GENERATED FROM THE NAVIGATION, NOT HAND-WRITTEN, and that is the whole
// point. A hand-written tour of the app is correct on the day it is written
// and wrong by the next feature - and a confidently wrong answer about where
// something lives is worse than "I do not know", because the person goes
// looking. navGroupsForRole is the same definition the sidebar renders, so a
// screen that gets added, renamed or moved changes this in the same commit.
//
// IT IS ALSO ROLE-FILTERED BY CONSTRUCTION. A member is never told to open
// /admin/timesheets, because that entry is not in their nav to begin with -
// so the assistant cannot describe a door they will find locked, and cannot
// hint at what is behind it either.
//
// Hiding a link is not access control - the nav's own header says so, and it
// is still true here. This block shapes what the assistant TALKS about; what
// it can actually READ is decided by the tool's own session check. The two
// are deliberately separate, because a prompt is guidance and a guard is not.
// -------------------------------------------------------------------

// The words this business uses, where they are not the ordinary ones. Kept
// short: a glossary is for the terms somebody would otherwise guess at, and
// every line that merely restates an obvious word makes the useful ones
// harder to find.
const GLOSSARY = [
  "A CLIENT is who work is for. Jira calls it a project and keys it like TSSS; here it is the client's name.",
  "A PROJECT is what an invoice is written against. Jira calls it the parent issue and keys it like TSSS-59.",
  "BILLABLE means the time can go on an invoice. NON-BILLABLE is legitimate work that cannot - training, leave, internal admin. UNSET means nobody has said which, and that is a data problem rather than a third category.",
  "UTILISATION is hours logged against the hours somebody is contracted to work, not against a flat five-day week. Somebody on three days a week is measured against three.",
  "CHARGEABLE VALUE is what billable time is worth at charge rates. COST is what every logged hour costs the business, billable or not. MARGIN is the difference.",
  "READY TO INVOICE is billable time that also has a work description against it. Billable time with no description is not ready.",
];

function areaFor(role: UserRole): string {
  switch (role) {
    case USER_ROLES.ADMIN:
      return "the admin area";
    case USER_ROLES.MANAGER:
      return "the manager area, scoped to the teams an administrator has assigned them";
    default:
      return "their own portal area";
  }
}

export function appKnowledgePrompt(role: UserRole, userName: string | null): string {
  const groups = navGroupsForRole(role);

  const screens: string[] = [];
  for (const group of groups) {
    for (const entry of group.items) {
      if (isCollapsible(entry)) {
        for (const child of entry.children) {
          screens.push(`${entry.label} > ${child.label} (${child.href}) - ${child.tooltip}`);
        }
      } else {
        screens.push(`${entry.label} (${entry.href}) - ${entry.tooltip}`);
      }
    }
  }

  return [
    "ABOUT THIS APP, so you can answer questions about the app itself and not only about data.",
    "",
    `It is a staff portal. The person you are talking to is ${userName ?? "a signed-in user"}, whose role is ${USER_ROLE_LABELS[role]}, so they are in ${areaFor(role)}.`,
    "There are three areas - admin, manage and portal - and which one somebody sees is decided by their role, not by them choosing.",
    "Sign-in is through Microsoft; accounts are not created by hand and passwords are not managed here.",
    "",
    "THE SCREENS THIS PERSON CAN OPEN, with the path and what each is for:",
    ...screens.map((screen) => `- ${screen}`),
    "",
    "Do not mention screens that are not in that list. It is already filtered to what this person's role can reach,",
    "so anything absent is either something they cannot open or something the app does not have.",
    "When somebody asks where to do something, name the screen and give its path.",
    "",
    "TIMESHEET DATA COMES FROM JIRA and is read-only here - the app never writes to Jira, and a figure that looks wrong",
    "is fixed in Jira and then re-synced with Refresh from Jira. Time is recorded against a project in Jira, and the app",
    "aggregates it. Charge rates, cost rates and contracted days ARE set in this app, on the Staff screen.",
    "",
    "WORDS THIS BUSINESS USES:",
    ...GLOSSARY.map((line) => `- ${line}`),
    "",
    "WHAT YOU CANNOT DO, and should say plainly rather than attempt:",
    "- You cannot change anything. You have no way to edit a setting, log time, run a sync or write to Jira. Tell people where to do it themselves.",
    "- You cannot read other people's conversations, or files that were not attached to this one.",
    "- You only know the app as described above. If somebody asks about a screen or a feature not listed, say you do not know of it rather than guessing at how it might work.",
  ].join("\n");
}
