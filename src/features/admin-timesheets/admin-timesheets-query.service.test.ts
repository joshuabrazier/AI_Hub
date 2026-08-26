import { describe, expect, it } from "vitest";

import { admitOption, admitStart } from "./admin-timesheets-query.service";

// -------------------------------------------------------------------
// The allowlist. This is the security boundary of the natural-language
// feature, and it is tested directly rather than through the model, because
// the whole point of it is to hold when the model does not.
//
// The live model behaves well: asked to inject, it named the injection and
// returned no filter. That is a property of a model version and a prompt, not
// a guarantee, and it is not what anybody should be relying on. What holds is
// this: a value the service did not offer never reaches a query.
// -------------------------------------------------------------------

const offered = new Set(["External", "Internal"]);

describe("admitOption", () => {
  it("admits a value that was offered", () => {
    const rejected: string[] = [];

    expect(admitOption("External", offered, "that category", rejected)).toBe("External");
    expect(rejected).toEqual([]);
  });

  it("drops a value that was NOT offered, and says which kind it was", () => {
    const rejected: string[] = [];

    expect(admitOption("Confidential", offered, "that category", rejected)).toBeUndefined();
    expect(rejected).toEqual(["that category"]);
  });

  it("drops SQL-shaped text rather than passing it to a query", () => {
    // Kysely parameterises everything, so this was never injectable. It is
    // dropped because it is not a category, which is the more useful property:
    // the same check catches a plausible-looking invented value.
    const rejected: string[] = [];

    expect(admitOption("DROP TABLE worklog_fact", offered, "that category", rejected)).toBeUndefined();
    expect(admitOption("' OR 1=1 --", offered, "that category", rejected)).toBeUndefined();
    expect(rejected).toHaveLength(2);
  });

  it("treats 'all' as no filter rather than as a value to look up", () => {
    // 'all' is in the vocabulary so the model can express "everyone", but it
    // is not a predicate - it means leave the parameter off.
    const rejected: string[] = [];

    expect(admitOption("all", offered, "that category", rejected)).toBeUndefined();
    expect(rejected).toEqual([]);
  });

  it("treats null and empty string as no filter, not as a rejection", () => {
    const rejected: string[] = [];

    expect(admitOption(null, offered, "that category", rejected)).toBeUndefined();
    expect(admitOption("", offered, "that category", rejected)).toBeUndefined();
    expect(rejected).toEqual([]);
  });

  it("is exact, not fuzzy: a near miss is a miss", () => {
    // Deliberate. A model that returns "external" for "External" has guessed,
    // and quietly correcting it here would hide that the vocabulary was not
    // followed.
    const rejected: string[] = [];

    expect(admitOption("external", offered, "that category", rejected)).toBeUndefined();
    expect(admitOption("External ", offered, "that category", rejected)).toBeUndefined();
    expect(rejected).toHaveLength(2);
  });

  it("admits an account id only when that exact id was offered", () => {
    const people = new Set(["712020:1916ed76-9174-4ef0-8968-e0d72bb69d60"]);
    const rejected: string[] = [];

    expect(admitOption("712020:1916ed76-9174-4ef0-8968-e0d72bb69d60", people, "that person", rejected)).toBe(
      "712020:1916ed76-9174-4ef0-8968-e0d72bb69d60",
    );
    // A real-looking id for somebody who is not in this period.
    expect(admitOption("712020:00000000-0000-0000-0000-000000000000", people, "that person", rejected)).toBeUndefined();
    expect(rejected).toEqual(["that person"]);
  });
});

describe("admitStart", () => {
  it("admits a real calendar date", () => {
    const rejected: string[] = [];

    expect(admitStart("2026-07-01", rejected)).toBe("2026-07-01");
    expect(rejected).toEqual([]);
  });

  it("rejects a day that does not exist", () => {
    // 2026-02-31 parses in JS and rolls forward to March. Admitting it would
    // silently open the wrong month.
    const rejected: string[] = [];

    expect(admitStart("2026-02-31", rejected)).toBeUndefined();
    expect(admitStart("2026-13-01", rejected)).toBeUndefined();
    expect(rejected).toHaveLength(2);
  });

  it("rejects a date far outside any period worth viewing", () => {
    const rejected: string[] = [];

    expect(admitStart("1900-01-01", rejected)).toBeUndefined();
    expect(admitStart("2999-01-01", rejected)).toBeUndefined();
    expect(rejected).toHaveLength(2);
  });

  it("treats null as no date rather than a rejection", () => {
    const rejected: string[] = [];

    expect(admitStart(null, rejected)).toBeUndefined();
    expect(rejected).toEqual([]);
  });

  it("accepts a leap day in a leap year and rejects it otherwise", () => {
    const rejected: string[] = [];

    expect(admitStart("2028-02-29", rejected)).toBe("2028-02-29");
    expect(admitStart("2026-02-29", rejected)).toBeUndefined();
    expect(rejected).toEqual(["the date"]);
  });
});
