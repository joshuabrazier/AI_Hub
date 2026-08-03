import { test as base, expect } from "@playwright/test";

// -------------------------------------------------------------------
// The suite's `test`, with a per-test budget that fits what these tests do.
//
// Playwright's default is 30 seconds for the WHOLE test, and almost every spec
// here signs in through the real login form before it asserts anything. A real
// sign-in costs a page load, hydration, a password hash and a session write -
// so on a loaded server the entire budget went on the setup and the assertion
// the test exists for never ran.
//
// That failure is worth describing, because it is a trap. A test that runs out
// of time mid-sign-in reports "expected not to be on /sign-in, received
// /sign-in", which reads exactly like the app refusing a valid login. It is
// not: it is the clock. Chasing it as an authorization bug is wasted time, and
// "fixing" the app to make it go away would be worse than wasted.
//
// The number is deliberately generous rather than tight. These tests drive a
// real browser against a real server and a real database; a tight limit here
// buys nothing and turns machine load into a red failure.
//
// This would sit more naturally as a top-level `timeout` in
// playwright.config.ts. It is here so that it applies from inside tests/,
// where the rest of the suite lives, and so there is one place to change it.
// -------------------------------------------------------------------
// Not exported: the fixture below is the only thing that should apply it, so
// there is nothing for a spec to import and quietly diverge from.
const TEST_TIMEOUT_MS = 120_000;

export const test = base.extend<{ generousTimeout: void }>({
  // An automatic fixture: it runs for every test without being asked for, so
  // no spec has to remember to opt in. Setting it here rather than calling
  // test.setTimeout() in each file keeps the budget in one place.
  generousTimeout: [
    async ({}, use, testInfo) => {
      testInfo.setTimeout(TEST_TIMEOUT_MS);
      await use();
    },
    { auto: true },
  ],
});

export { expect };
