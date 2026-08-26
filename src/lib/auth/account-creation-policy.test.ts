import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The allowlist is read off the validated server env, so the tests set it
// before importing the module under test and reset the module registry
// between cases.
async function loadPolicy(domains: string | undefined) {
  vi.resetModules();

  if (domains === undefined) delete process.env.AUTH_ALLOWED_EMAIL_DOMAINS;
  else process.env.AUTH_ALLOWED_EMAIL_DOMAINS = domains;

  return import("./account-creation-policy");
}

// -------------------------------------------------------------------
// These tests are slow for a reason that has nothing to do with the code
// they cover, which is a pure string comparison.
//
// Reading the allowlist off the validated env means the module has to be
// re-imported to see a different one, and resetModules() throws away the
// WHOLE graph behind it - including the env schema - so every case pays for
// a full reload. Seven of those runs past the 5s default when the suite is
// running files in parallel and the machine is busy, which shows up as a
// flaky CI failure rather than an honest one.
//
// Raised here rather than globally: a longer timeout everywhere would hide
// the next test that is slow for a real reason.
// -------------------------------------------------------------------
vi.setConfig({ testTimeout: 30_000 });

const originalValue = process.env.AUTH_ALLOWED_EMAIL_DOMAINS;

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  if (originalValue === undefined) delete process.env.AUTH_ALLOWED_EMAIL_DOMAINS;
  else process.env.AUTH_ALLOWED_EMAIL_DOMAINS = originalValue;
});

describe("isEmailDomainAllowed", () => {
  it("accepts an address on the allowlist", async () => {
    const { isEmailDomainAllowed } = await loadPolicy("example.com");

    expect(isEmailDomainAllowed("person@example.com")).toBe(true);
    // Case and surrounding whitespace are normalised, because an address
    // arriving from an identity provider is not guaranteed to be lowercase.
    expect(isEmailDomainAllowed("  Person@Example.COM  ")).toBe(true);
  });

  it("rejects a lookalike domain an attacker could register", async () => {
    // The reason this is not implemented with endsWith. Every one of these
    // would pass a naive suffix test against "example.com", and each is a
    // domain somebody can simply go and buy.
    const { isEmailDomainAllowed } = await loadPolicy("example.com");

    expect(isEmailDomainAllowed("person@evil-example.com")).toBe(false);
    expect(isEmailDomainAllowed("person@notexample.com")).toBe(false);
    expect(isEmailDomainAllowed("person@example.com.evil.net")).toBe(false);
  });

  it("does not accept a subdomain unless it is listed", async () => {
    const { isEmailDomainAllowed } = await loadPolicy("example.com");

    expect(isEmailDomainAllowed("person@mail.example.com")).toBe(false);
  });

  it("supports several domains", async () => {
    const { isEmailDomainAllowed } = await loadPolicy("example.com, example.org");

    expect(isEmailDomainAllowed("a@example.com")).toBe(true);
    expect(isEmailDomainAllowed("b@example.org")).toBe(true);
    expect(isEmailDomainAllowed("c@example.net")).toBe(false);
  });

  it("tolerates a leading @ in configuration", async () => {
    // "@example.com" is the form somebody naturally writes; accepting it
    // avoids a silent lockout where every sign-in is refused because the
    // configured value could never match a parsed domain.
    const { isEmailDomainAllowed } = await loadPolicy("@example.com");

    expect(isEmailDomainAllowed("person@example.com")).toBe(true);
  });

  it("allows everything when unset, which is the base-repo default", async () => {
    const { isEmailDomainAllowed } = await loadPolicy(undefined);

    expect(isEmailDomainAllowed("anyone@anywhere.example")).toBe(true);
  });

  it("rejects a malformed address rather than letting it through", async () => {
    const { isEmailDomainAllowed } = await loadPolicy("example.com");

    expect(isEmailDomainAllowed("no-at-sign")).toBe(false);
    expect(isEmailDomainAllowed("trailing@")).toBe(false);
  });
});
