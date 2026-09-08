import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MAX_TIMESHEET_ADDED_ROWS } from "../delivery.types";
import { readAddedRows, writeAddedRows } from "./timesheet-row-store";

// -------------------------------------------------------------------
// The empty rows a browser is holding for a week.
//
// Everything here is furniture rather than data, which is exactly why it is
// tested: the failures are all silent. A store that grows without limit, a
// list that outruns the cap the service applies, or a parse that trusts what
// it finds all end in the same place - a week that will not open, or one
// that opens without the rows somebody set up.
//
// It runs in the `node` environment, so a localStorage is stubbed in. The
// module reads `window.localStorage` and nothing else about a browser.
// -------------------------------------------------------------------

const USER = "user-1";
const WEEK = "2026-09-07";

function stubLocalStorage() {
  const contents = new Map<string, string>();

  return {
    getItem: (key: string) => contents.get(key) ?? null,
    setItem: (key: string, value: string) => {
      contents.set(key, value);
    },
    removeItem: (key: string) => {
      contents.delete(key);
    },
    clear: () => contents.clear(),
    key: () => null,
    length: 0,
  } as unknown as Storage;
}

let localStorageStub: Storage;

beforeEach(() => {
  localStorageStub = stubLocalStorage();
  vi.stubGlobal("window", { localStorage: localStorageStub });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the added-row store", () => {
  it("hands back what was written, for that user and that week only", () => {
    writeAddedRows(USER, WEEK, ["task-1", "task-2"]);

    expect(readAddedRows(USER, WEEK)).toEqual(["task-1", "task-2"]);
    expect(readAddedRows(USER, "2026-09-14")).toEqual([]);
    expect(readAddedRows("user-2", WEEK)).toEqual([]);
  });

  it("de-duplicates, because the same task must not become two rows", () => {
    writeAddedRows(USER, WEEK, ["task-1", "task-1", "task-2"]);

    expect(readAddedRows(USER, WEEK)).toEqual(["task-1", "task-2"]);
  });

  // The service caps the list before it becomes an `in` list. A store that
  // handed back more would have the whole request refused on the schema
  // rather than trimmed.
  it("never hands back more rows than the service will accept", () => {
    const taskIds = Array.from({ length: MAX_TIMESHEET_ADDED_ROWS + 20 }, (_unused, index) => `task-${index}`);

    writeAddedRows(USER, WEEK, taskIds);

    expect(readAddedRows(USER, WEEK)).toHaveLength(MAX_TIMESHEET_ADDED_ROWS);
  });

  it("forgets a week once its rows have gone, rather than keeping an empty list", () => {
    writeAddedRows(USER, WEEK, ["task-1"]);
    writeAddedRows(USER, WEEK, []);

    expect(readAddedRows(USER, WEEK)).toEqual([]);
    expect(localStorageStub.getItem("delivery.timesheet.added-rows.v1")).not.toContain(WEEK);
  });

  // Somebody who fills in a timesheet every week for a year must not
  // accumulate a year of dead weeks in their browser.
  it("keeps only the most recent weeks", () => {
    for (let index = 1; index <= 12; index += 1) {
      writeAddedRows(USER, `2026-01-${String(index).padStart(2, "0")}`, [`task-${index}`]);
    }

    expect(readAddedRows(USER, "2026-01-01")).toEqual([]);
    expect(readAddedRows(USER, "2026-01-12")).toEqual(["task-12"]);
  });

  it("keeps one person's rows when another person's week is written", () => {
    writeAddedRows(USER, WEEK, ["task-1"]);
    writeAddedRows("user-2", WEEK, ["task-9"]);

    expect(readAddedRows(USER, WEEK)).toEqual(["task-1"]);
    expect(readAddedRows("user-2", WEEK)).toEqual(["task-9"]);
  });

  // The value comes out of a store the app does not control. Anything that
  // is not a list of strings is dropped rather than handed to a query.
  it("ignores rubbish left in the store", () => {
    localStorageStub.setItem("delivery.timesheet.added-rows.v1", "not json at all");
    expect(readAddedRows(USER, WEEK)).toEqual([]);

    localStorageStub.setItem("delivery.timesheet.added-rows.v1", JSON.stringify([1, 2, 3]));
    expect(readAddedRows(USER, WEEK)).toEqual([]);

    localStorageStub.setItem(
      "delivery.timesheet.added-rows.v1",
      JSON.stringify({ [USER]: { [WEEK]: ["task-1", 7, null, "task-2"] } }),
    );
    expect(readAddedRows(USER, WEEK)).toEqual(["task-1", "task-2"]);
  });

  it("does nothing at all without a browser", () => {
    vi.unstubAllGlobals();

    expect(() => writeAddedRows(USER, WEEK, ["task-1"])).not.toThrow();
    expect(readAddedRows(USER, WEEK)).toEqual([]);
  });
});
