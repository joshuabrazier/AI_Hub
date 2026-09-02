import { describe, expect, it } from "vitest";

import {
  adfToPlainText,
  classifyRnd,
  hoursFieldToSeconds,
  labelsSnapshot,
  normaliseText,
  readCustomFieldValue,
  readLabels,
  toAppZoneDate,
  toAppZoneSecondOfDay,
} from "./jira-mapping";

const ADELAIDE = "Australia/Adelaide";

// -------------------------------------------------------------------
// Timezone conversion
//
// The risk this guards is the one worth the most: get it wrong and every
// daily figure is wrong for part of every day, differently either side of the
// October daylight saving change, and the report still looks entirely
// plausible.
//
// Adelaide is UTC+9:30 (ACST) in winter and UTC+10:30 (ACDT) in summer. In
// 2026 the change is on 4 October.
// -------------------------------------------------------------------
describe("toAppZoneDate", () => {
  it("keeps a 9am Adelaide entry on the day it was worked", () => {
    // The headline case: 9am Adelaide is 23:30 the PREVIOUS day in UTC.
    // Anything that reads the date off a UTC timestamp loses a day here.
    expect(toAppZoneDate("2026-08-10T09:00:00.000+09:30", ADELAIDE)).toBe("2026-08-10");
  });

  it("gives the same day for the same instant written as UTC", () => {
    // Identical moment, different notation. The answer cannot depend on how
    // Jira happened to format it.
    expect(toAppZoneDate("2026-08-09T23:30:00.000Z", ADELAIDE)).toBe("2026-08-10");
  });

  it("holds either side of the October daylight saving change", () => {
    // 3 October is ACST (+9:30), 5 October is ACDT (+10:30). A hardcoded
    // offset gets one of these two wrong, whichever one it picked.
    expect(toAppZoneDate("2026-10-02T23:30:00.000Z", ADELAIDE)).toBe("2026-10-03");
    expect(toAppZoneDate("2026-10-04T22:30:00.000Z", ADELAIDE)).toBe("2026-10-05");
  });

  it("puts work logged from another timezone on the Adelaide day it lands on", () => {
    // 9am UTC is 6:30pm in Adelaide, same day.
    expect(toAppZoneDate("2026-08-10T09:00:00.000Z", ADELAIDE)).toBe("2026-08-10");
    // 4pm UTC is 1:30am the NEXT day in Adelaide.
    expect(toAppZoneDate("2026-08-10T16:00:00.000Z", ADELAIDE)).toBe("2026-08-11");
  });
});

describe("toAppZoneSecondOfDay", () => {
  it("reads 9am as 9am regardless of the offset in the timestamp", () => {
    expect(toAppZoneSecondOfDay("2026-08-10T09:00:00.000+09:30", ADELAIDE)).toBe(32400);
    expect(toAppZoneSecondOfDay("2026-08-09T23:30:00.000Z", ADELAIDE)).toBe(32400);
  });

  it("still reads 9am as 9am under daylight saving", () => {
    // Two entries an overlap check would compare must be on the same clock,
    // and that clock is the wall clock, not UTC.
    expect(toAppZoneSecondOfDay("2026-10-04T22:30:00.000Z", ADELAIDE)).toBe(32400);
  });

  it("converts an afternoon start", () => {
    // 10:37am, the overlap fixture's second entry: 10 * 3600 + 37 * 60.
    expect(toAppZoneSecondOfDay("2026-08-12T10:37:00.000+09:30", ADELAIDE)).toBe(38220);
  });

  it("reads midnight as zero and not as a whole day", () => {
    expect(toAppZoneSecondOfDay("2026-08-10T00:00:00.000+09:30", ADELAIDE)).toBe(0);
  });
});

// -------------------------------------------------------------------
// Atlassian Document Format
// -------------------------------------------------------------------
describe("adfToPlainText", () => {
  it("pulls the text out of a document", () => {
    const doc = {
      type: "doc",
      version: 1,
      content: [{ type: "paragraph", content: [{ type: "text", text: "Built the booking form" }] }],
    };

    expect(normaliseText(doc)).toBe("Built the booking form");
  });

  it("keeps paragraphs apart rather than running them together", () => {
    const doc = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "First" }] },
        { type: "paragraph", content: [{ type: "text", text: "Second" }] },
      ],
    };

    // Without the block handling this would read "FirstSecond".
    expect(normaliseText(doc)).toBe("First Second");
  });

  it("descends into node types it has never heard of", () => {
    // ADF gains node types over time. Text inside an unknown one is still
    // text somebody typed, and dropping it would silently shorten an invoice
    // line.
    const doc = {
      type: "doc",
      content: [{ type: "somethingNew", content: [{ type: "text", text: "Still real text" }] }],
    };

    expect(normaliseText(doc)).toBe("Still real text");
  });

  it("returns nothing for an empty document", () => {
    expect(normaliseText({ type: "doc", content: [] })).toBeNull();
    expect(normaliseText(null)).toBeNull();
    expect(normaliseText(undefined)).toBeNull();
  });

  it("does not turn an object into [object Object]", () => {
    // The specific failure this exists to prevent: an ADF comment rendered
    // straight onto an invoice line.
    expect(adfToPlainText({ type: "doc", content: [] })).not.toContain("object Object");
  });
});

describe("normaliseText", () => {
  it("treats a blank string as nothing", () => {
    expect(normaliseText("   ")).toBeNull();
    expect(normaliseText("")).toBeNull();
  });

  it("collapses whitespace", () => {
    expect(normaliseText("  two   words \n here ")).toBe("two words here");
  });
});

// -------------------------------------------------------------------
// Custom fields
// -------------------------------------------------------------------
describe("readCustomFieldValue", () => {
  it("reads a select field", () => {
    expect(readCustomFieldValue({ value: "Billable", id: "10001" })).toBe("Billable");
  });

  it("reads a plain text field", () => {
    expect(readCustomFieldValue("Non-billable")).toBe("Non-billable");
  });

  it("reads the first entry of a multi-select", () => {
    expect(readCustomFieldValue([{ value: "Billable" }, { value: "Non-billable" }])).toBe("Billable");
  });

  it("falls back to a name where there is no value", () => {
    expect(readCustomFieldValue({ name: "External" })).toBe("External");
  });

  it("returns nothing for an unset field", () => {
    expect(readCustomFieldValue(null)).toBeNull();
    expect(readCustomFieldValue(undefined)).toBeNull();
    expect(readCustomFieldValue({})).toBeNull();
    expect(readCustomFieldValue([])).toBeNull();
  });

  it("passes an unexpected value through instead of rejecting it", () => {
    // A value nobody planned for must reach the read model and surface as a
    // finding. Rejecting it here would drop the worklog with it.
    expect(readCustomFieldValue({ value: "Maybe billable?" })).toBe("Maybe billable?");
  });
});

describe("hoursFieldToSeconds", () => {
  it("converts hours to seconds", () => {
    expect(hoursFieldToSeconds(7.5)).toBe(27000);
    expect(hoursFieldToSeconds(900)).toBe(3240000);
    expect(hoursFieldToSeconds("40")).toBe(144000);
  });

  it("returns nothing rather than NaN for junk", () => {
    // Storing NaN would poison every total downstream of it.
    expect(hoursFieldToSeconds("not a number")).toBeNull();
    expect(hoursFieldToSeconds(null)).toBeNull();
    expect(hoursFieldToSeconds(-5)).toBeNull();
    expect(hoursFieldToSeconds({})).toBeNull();
  });
});

// -------------------------------------------------------------------
// R&D classification from labels.
//
// This decides which hours can appear in an R&D Tax Incentive claim, so
// the rules that matter are the ones about what is NOT admitted: exact
// casing, and no third category for an item carrying both labels.
// -------------------------------------------------------------------
describe("readLabels", () => {
  it("keeps the label array Jira sent", () => {
    expect(readLabels(["RnD-core", "urgent"])).toEqual(["RnD-core", "urgent"]);
  });

  it("treats a missing or malformed labels field as no labels", () => {
    expect(readLabels(undefined)).toEqual([]);
    expect(readLabels(null)).toEqual([]);
    expect(readLabels("RnD-core")).toEqual([]);
  });

  it("drops entries that are not usable strings rather than stringifying them", () => {
    // "[object Object]" in the snapshot would be worse than a shorter list:
    // the snapshot is the evidence for the classification.
    expect(readLabels(["RnD-core", { x: 1 }, "", "   ", 42, null])).toEqual(["RnD-core"]);
  });
});

describe("labelsSnapshot", () => {
  it("stores the whole array, not just the labels we act on", () => {
    // "What did this item actually look like" is the question asked of a
    // snapshot, and a filtered copy cannot answer it.
    expect(labelsSnapshot(["urgent", "RnD-core", "q3"])).toBe("urgent,RnD-core,q3");
  });

  it("is NULL for no labels, not an empty string", () => {
    expect(labelsSnapshot([])).toBeNull();
  });
});

describe("classifyRnd", () => {
  it("reads core and supporting", () => {
    expect(classifyRnd(["RnD-core"])).toEqual({ rndClass: "core", hasBothLabels: false });
    expect(classifyRnd(["RnD-supporting"])).toEqual({ rndClass: "supporting", hasBothLabels: false });
  });

  it("is null when neither label is present", () => {
    expect(classifyRnd([])).toEqual({ rndClass: null, hasBothLabels: false });
    expect(classifyRnd(["urgent", "q3"])).toEqual({ rndClass: null, hasBothLabels: false });
  });

  it("resolves both labels to core AND reports it", () => {
    // Both is a data entry error, not a third category. The hours must not
    // be counted into two buckets, and somebody has to fix the item - so
    // the flag travels rather than the number being quietly decided here.
    expect(classifyRnd(["RnD-core", "RnD-supporting"])).toEqual({ rndClass: "core", hasBothLabels: true });
  });

  it("is CASE SENSITIVE, so a near miss is a miss", () => {
    // Jira labels are case-sensitive; "rnd-core" is a different label. An
    // hour wrongly left out of a claim is a smaller problem than an hour
    // wrongly claimed, so this fails towards unclassified.
    expect(classifyRnd(["rnd-core"]).rndClass).toBeNull();
    expect(classifyRnd(["RND-CORE"]).rndClass).toBeNull();
    expect(classifyRnd(["RnD-Core"]).rndClass).toBeNull();
  });

  it("does not match a label that merely contains the name", () => {
    expect(classifyRnd(["not-RnD-core", "RnD-core-2027"]).rndClass).toBeNull();
  });

  it("ignores unrelated labels alongside a real one", () => {
    expect(classifyRnd(["urgent", "RnD-supporting", "q3"]).rndClass).toBe("supporting");
  });
});
