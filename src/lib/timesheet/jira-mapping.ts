import { formatInTimeZone } from "date-fns-tz";

import { APP_TIME_ZONE } from "../timezone";

// -------------------------------------------------------------------
// Jira payload mapping
//
// Pure functions turning what Jira sends into what the read model stores. No
// network here, so every one of these is testable on its own - which matters,
// because the timezone conversion below is the single easiest thing in this
// build to get quietly, systematically wrong.
// -------------------------------------------------------------------

const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 3600;

// -------------------------------------------------------------------
// Atlassian Document Format to plain text.
//
// The v3 REST API returns descriptions and worklog comments as ADF, a nested
// JSON document, NOT as a string. Reading `.comment` directly gives you
// "[object Object]" on an invoice line, so the tree is walked and its text
// nodes collected.
//
// Unknown node types are descended into rather than skipped: ADF gains node
// types over time, and text buried in one this code has never heard of is
// still text somebody typed.
// -------------------------------------------------------------------
export function adfToPlainText(node: unknown): string {
  if (node === null || node === undefined) return "";
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(adfToPlainText).join("");

  if (typeof node !== "object") return "";

  const record = node as Record<string, unknown>;

  if (record.type === "text" && typeof record.text === "string") return record.text;

  // Block-level nodes become their own line so paragraphs do not run together.
  const isBlock =
    record.type === "paragraph" ||
    record.type === "heading" ||
    record.type === "listItem" ||
    record.type === "blockquote";

  const inner = adfToPlainText(record.content);
  return isBlock ? `${inner}\n` : inner;
}

// Collapse the runs of whitespace the walk above leaves behind, and return
// null for anything that turns out to hold no text at all.
export function normaliseText(value: unknown): string | null {
  const text = typeof value === "string" ? value : adfToPlainText(value);
  const collapsed = text.replace(/\s+/g, " ").trim();
  return collapsed.length > 0 ? collapsed : null;
}

// -------------------------------------------------------------------
// A Jira timestamp to an app-zone calendar date.
//
// Jira sends "2026-08-10T09:00:00.000+0930". Taking the first ten characters
// works by luck when the author is in Adelaide and breaks the moment someone
// logs time from another zone, or when the offset in the string differs from
// the app's. Converting explicitly is the only version that holds, and
// date-fns-tz applies the right offset either side of the October change on
// its own.
// -------------------------------------------------------------------
export function toAppZoneDate(started: string, timeZone: string = APP_TIME_ZONE): string {
  return formatInTimeZone(new Date(started), timeZone, "yyyy-MM-dd");
}

// -------------------------------------------------------------------
// The same timestamp as seconds past app-zone midnight, which is what the
// overlap rule compares. Derived from the app-zone wall clock rather than
// from the instant, so two entries that LOOK simultaneous in Jira are
// simultaneous here too.
// -------------------------------------------------------------------
export function toAppZoneSecondOfDay(started: string, timeZone: string = APP_TIME_ZONE): number {
  const [hours, minutes, seconds] = formatInTimeZone(new Date(started), timeZone, "HH:mm:ss")
    .split(":")
    .map((part) => Number.parseInt(part, 10));

  return hours * SECONDS_PER_HOUR + minutes * SECONDS_PER_MINUTE + seconds;
}

// -------------------------------------------------------------------
// A custom field's value to the billable status.
//
// Jira custom fields arrive in several shapes depending on how the field was
// configured: a select gives { value: "Billable" }, a radio the same, a text
// field a bare string, a multi-select an array. All of them are accepted
// because which one it is depends on site configuration nobody here controls.
//
// The value is passed through as-is rather than mapped onto an enum. An
// unexpected value must reach the read model and show up as a finding; if it
// were rejected here the worklog would be dropped, and dropped time is the
// one error nobody notices.
// -------------------------------------------------------------------
export function readCustomFieldValue(field: unknown): string | null {
  if (field === null || field === undefined) return null;
  if (typeof field === "string") return normaliseText(field);
  if (typeof field === "number") return String(field);

  if (Array.isArray(field)) {
    // First non-empty entry. A multi-select with two answers to a yes/no
    // question is a data problem, not something to silently merge.
    for (const entry of field) {
      const value = readCustomFieldValue(entry);
      if (value) return value;
    }
    return null;
  }

  if (typeof field === "object") {
    const record = field as Record<string, unknown>;
    if (typeof record.value === "string") return normaliseText(record.value);
    if (typeof record.name === "string") return normaliseText(record.name);
  }

  return null;
}

// -------------------------------------------------------------------
// Hours to seconds, for an estimate typed as a number of hours in a custom
// field. Returns null for anything that is not a finite positive number,
// rather than coercing a stray string to NaN and storing that.
// -------------------------------------------------------------------
export function hoursFieldToSeconds(field: unknown): number | null {
  const raw = typeof field === "number" ? field : typeof field === "string" ? Number.parseFloat(field) : Number.NaN;
  if (!Number.isFinite(raw) || raw < 0) return null;
  return Math.round(raw * SECONDS_PER_HOUR);
}

// -------------------------------------------------------------------
// R&D classification from an issue's labels
//
// Two labels exist site-wide and are applied across every space, client
// spaces included, so this is a property of the WORK ITEM and not of the
// space it lives in. Work in a client space can be R&D.
//
// The casing is exact. Jira labels are case-sensitive and "rnd-core" is a
// different label from "RnD-core" - so a near miss is a miss, and is
// reported as unclassified rather than quietly admitted. That is the
// safer direction for a tax claim: an hour wrongly left out is a smaller
// problem than an hour wrongly claimed.
// -------------------------------------------------------------------
export const RND_CORE_LABEL = "RnD-core";
export const RND_SUPPORTING_LABEL = "RnD-supporting";

export type RndClass = "core" | "supporting";

export interface RndClassification {
  rndClass: RndClass | null;
  // Both labels on one item is a data entry error, not a third category.
  // It resolves to core - the more conservative of the two is NOT the
  // right instinct here, because core and supporting are claimed at
  // different rates and an item marked both is being asserted as core by
  // whoever added that label. It is surfaced either way so somebody fixes
  // the item rather than the number being quietly decided here.
  hasBothLabels: boolean;
}

// -------------------------------------------------------------------
// The label array as Jira sent it, normalised to strings.
//
// Anything that is not a non-empty string is dropped rather than
// stringified: "[object Object]" in a labels snapshot would be worse than
// a shorter list, because the snapshot is the evidence for the
// classification.
// -------------------------------------------------------------------
export function readLabels(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  return value.filter((label): label is string => typeof label === "string" && label.trim().length > 0);
}

// -------------------------------------------------------------------
// Store the WHOLE label array, comma separated.
//
// Not just the two we act on. When a classification is questioned later
// the question is "what did this item actually look like", and a filtered
// copy cannot answer it.
// -------------------------------------------------------------------
export function labelsSnapshot(labels: string[]): string | null {
  return labels.length > 0 ? labels.join(",") : null;
}

export function classifyRnd(labels: string[]): RndClassification {
  const hasCore = labels.includes(RND_CORE_LABEL);
  const hasSupporting = labels.includes(RND_SUPPORTING_LABEL);

  if (hasCore && hasSupporting) return { rndClass: "core", hasBothLabels: true };
  if (hasCore) return { rndClass: "core", hasBothLabels: false };
  if (hasSupporting) return { rndClass: "supporting", hasBothLabels: false };

  return { rndClass: null, hasBothLabels: false };
}
