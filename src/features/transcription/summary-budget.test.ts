import { describe, expect, it } from "vitest";

import {
  MAX_SUMMARY_ATTEMPTS,
  SUMMARY_CEILING_MS,
  SUMMARY_LEASE_MS,
  SUMMARY_MAX_TOKENS,
  SUMMARY_PREFILL_ALLOWANCE_MS,
  SLOWEST_TOKENS_PER_SECOND,
  SUMMARY_TIMEOUT_MS,
} from "./transcription.types";

// -------------------------------------------------------------------
// The relationship between the summary budgets.
//
// THIS FILE EXISTS BECAUSE THE NUMBERS DISAGREED IN PRODUCTION AND NOTHING
// NOTICED. The token cap allowed a 4,000-token summary; the timeout gave it
// 120 seconds; at the rate the model actually generates, 4,000 tokens takes
// longer than that. Every meeting long enough to need a full summary died at
// exactly 120,000ms - three attempts in a row - while short meetings finished
// in ten seconds and made the feature look healthy.
//
// Neither constant was wrong on its own. What was missing was anything
// asserting they had to agree, so these are that.
// -------------------------------------------------------------------

describe("summary budgets", () => {
  it("gives a full-length summary enough time to actually be generated", () => {
    // The assertion that would have failed the build before this was found.
    const generationMs = (SUMMARY_MAX_TOKENS / SLOWEST_TOKENS_PER_SECOND) * 1000;

    expect(SUMMARY_TIMEOUT_MS).toBeGreaterThanOrEqual(generationMs + SUMMARY_PREFILL_ALLOWANCE_MS);
  });

  it("stays inside the platform's own request ceiling", () => {
    // Azure App Service terminates a request at 230 seconds, and summarising
    // happens inside one. A timeout above the ceiling would protect nothing:
    // the platform would cut the connection first and the row would be left
    // mid-flight with no error recorded anywhere.
    expect(SUMMARY_TIMEOUT_MS).toBeLessThanOrEqual(SUMMARY_CEILING_MS);
    expect(SUMMARY_CEILING_MS).toBeLessThan(230_000);
  });

  it("cannot be satisfied by clamping alone", () => {
    // The clamp in SUMMARY_TIMEOUT_MS could hide a raised token cap by
    // silently capping the time instead of the tokens - which is exactly the
    // original bug wearing a hat. This asserts the cap genuinely fits inside
    // the ceiling rather than having been trimmed to look as though it does.
    const needed = (SUMMARY_MAX_TOKENS / SLOWEST_TOKENS_PER_SECOND) * 1000 + SUMMARY_PREFILL_ALLOWANCE_MS;

    expect(needed).toBeLessThanOrEqual(SUMMARY_CEILING_MS);
  });

  it("holds the lease for longer than an attempt can run", () => {
    // A lease shorter than an attempt would let a second sweep decide the
    // first had died while it was still generating - which is the duplicate
    // spending the lease exists to stop, reintroduced by the fix for it.
    expect(SUMMARY_LEASE_MS).toBeGreaterThan(SUMMARY_TIMEOUT_MS);
  });

  it("bounds what one transcription can ever cost", () => {
    // The point of counting attempts rather than minutes: this number is
    // knowable in advance. Three attempts of 4,000 tokens is the worst a
    // single meeting can spend before the app gives up and offers the
    // summary as a manual retry instead.
    expect(MAX_SUMMARY_ATTEMPTS).toBeGreaterThan(1);
    expect(MAX_SUMMARY_ATTEMPTS).toBeLessThanOrEqual(5);
    expect(MAX_SUMMARY_ATTEMPTS * SUMMARY_MAX_TOKENS).toBeLessThanOrEqual(20_000);
  });
});
