import { describe, expect, it } from "vitest";

import { buildCategorySplit, buildInvoiceReadiness, buildTopJobs } from "./overview-series";
import { WorklogFactRow } from "./timesheet.types";

// Every expectation is a hand-worked literal.
function fact(overrides: Partial<WorklogFactRow> = {}): WorklogFactRow {
  return {
    worklogId: overrides.worklogId ?? "w1",
    issueKey: overrides.issueKey ?? "TSSS-43",
    issueSummary: overrides.issueSummary ?? "Booking flow",
    // `===undefined` rather than `??`: a test that passes null MEANS null,
    // and ?? would quietly substitute the default and test nothing.
    parentKey: overrides.parentKey === undefined ? "TSSS-59" : overrides.parentKey,
    parentSummary: overrides.parentSummary === undefined ? "Website changes" : overrides.parentSummary,
    projectKey: overrides.projectKey ?? "TSSS",
    category: overrides.category === undefined ? "External" : overrides.category,
    personId: overrides.personId ?? "josh",
    personName: overrides.personName ?? "Joshua",
    workDate: overrides.workDate ?? "2026-08-11",
    startSecond: overrides.startSecond ?? null,
    timeSpentSeconds: overrides.timeSpentSeconds ?? 3600,
    billable: overrides.billable === undefined ? "Billable" : overrides.billable,
    billableSource: overrides.billableSource ?? "parent",
    hasNarrative: overrides.hasNarrative ?? true,
    isOrphan: overrides.isOrphan ?? false,
  };
}

describe("buildCategorySplit", () => {
  it("splits Internal from External, largest first", () => {
    const split = buildCategorySplit([
      fact({ category: "External", timeSpentSeconds: 7200 }),
      fact({ category: "Internal", timeSpentSeconds: 3600, billable: "Non-billable" }),
    ]);

    expect(split.map((slice) => slice.label)).toEqual(["External", "Internal"]);
    expect(split[0].hours).toBe(2);
    expect(split[0].share).toBe(0.6667);
    expect(split[1].nonBillableHours).toBe(1);
  });

  it("gives uncategorised time its own slice rather than hiding it", () => {
    const split = buildCategorySplit([fact({ category: null })]);
    expect(split[0].label).toBe("Uncategorised");
  });
});

describe("buildTopJobs", () => {
  const summaries = new Map([
    ["TSSS-59", "Website changes"],
    ["IO-1", "Administration"],
  ]);

  it("ranks jobs by hours and resolves their titles", () => {
    const jobs = buildTopJobs(
      [
        fact({ parentKey: "TSSS-59", timeSpentSeconds: 7200 }),
        fact({ parentKey: "IO-1", timeSpentSeconds: 3600 }),
      ],
      summaries,
    );

    expect(jobs.map((job) => job.label)).toEqual(["Website changes", "Administration"]);
    expect(jobs[0].hours).toBe(2);
  });

  it("counts the distinct people on each job", () => {
    const jobs = buildTopJobs(
      [
        fact({ parentKey: "TSSS-59", personId: "josh" }),
        fact({ parentKey: "TSSS-59", personId: "louis" }),
        fact({ parentKey: "TSSS-59", personId: "josh" }),
      ],
      summaries,
    );

    expect(jobs[0].peopleCount).toBe(2);
  });

  it("labels parentless time rather than dropping it", () => {
    const jobs = buildTopJobs([fact({ parentKey: null })], summaries);
    expect(jobs[0].label).toBe("No job");
  });

  it("folds the tail into one row instead of truncating silently", () => {
    // A chart that quietly drops rows reads as though it showed everything,
    // and then its bars do not add up to the headline figure.
    const many = Array.from({ length: 10 }, (unused, index) =>
      fact({ parentKey: `JOB-${index}`, timeSpentSeconds: (10 - index) * 3600 }),
    );

    const jobs = buildTopJobs(many, summaries, 3);

    expect(jobs).toHaveLength(4);
    expect(jobs[3].label).toBe("7 other jobs");
    // 4+3+2+1+... the seven smallest: 7,6,5,4,3,2,1 hours.
    expect(jobs[3].hours).toBe(28);
  });

  it("keeps every hour when it folds", () => {
    const many = Array.from({ length: 6 }, (unused, index) => fact({ parentKey: `JOB-${index}`, timeSpentSeconds: 3600 }));
    const jobs = buildTopJobs(many, summaries, 2);

    const total = jobs.reduce((sum, job) => sum + job.hours, 0);
    expect(total).toBe(6);
  });
});

describe("buildInvoiceReadiness", () => {
  it("counts billable time with no description as not ready", () => {
    // Seven hours that cannot be itemised is a harder fact to shrug at than
    // "nine entries need a description".
    const readiness = buildInvoiceReadiness([
      fact({ timeSpentSeconds: 3600, billable: "Billable", hasNarrative: true }),
      fact({ timeSpentSeconds: 3600, billable: "Billable", hasNarrative: false }),
    ]);

    expect(readiness.billableHours).toBe(2);
    expect(readiness.undescribedBillableHours).toBe(1);
    expect(readiness.readyHours).toBe(1);
    expect(readiness.readyShare).toBe(0.5);
  });

  it("ignores a missing description on non-billable time", () => {
    // Nobody itemises internal admin on an invoice, so its description does
    // not gate anything.
    const readiness = buildInvoiceReadiness([
      fact({ timeSpentSeconds: 3600, billable: "Non-billable", hasNarrative: false }),
    ]);

    expect(readiness.undescribedBillableHours).toBe(0);
    expect(readiness.billableHours).toBe(0);
  });

  it("counts unset billable status separately", () => {
    const readiness = buildInvoiceReadiness([fact({ timeSpentSeconds: 1800, billable: null })]);

    expect(readiness.unsetHours).toBe(0.5);
    expect(readiness.billableHours).toBe(0);
  });

  it("reports no ready share when nothing is billable", () => {
    const readiness = buildInvoiceReadiness([fact({ billable: "Non-billable" })]);
    expect(readiness.readyShare).toBeNull();
  });
});
