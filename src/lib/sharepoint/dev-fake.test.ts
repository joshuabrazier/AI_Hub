import { afterEach, describe, expect, it, vi } from "vitest";

// -------------------------------------------------------------------
// The local-development door, and the two conditions that hold it shut.
//
// This is the only test in the feature that is about a SECURITY property
// rather than a correctness one, so it is worth being explicit about what
// it is defending.
//
// The door replaces the Graph data source and skips minting a real token.
// On a deployed environment that must be impossible, and "impossible" has
// to mean impossible even when somebody copies a development .env onto a
// server - which is exactly how this class of flag gets left on. One
// condition would not survive that. Two do.
//
// Modules are re-imported per case because envServer is read at import
// time, so the flag cannot be changed on a module already loaded.
// -------------------------------------------------------------------

async function loadWith(mode: string, url: string | undefined) {
  vi.resetModules();

  vi.doMock("@/lib/env-server", () => ({
    envServer: { MODE: mode, DEV_FAKE_SHAREPOINT_URL: url },
  }));

  return await import("./dev-fake");
}

afterEach(() => {
  vi.doUnmock("@/lib/env-server");
  vi.resetModules();
});

describe("the fake SharePoint door", () => {
  it("is shut when nothing is configured, which is the default", () => {
    return loadWith("development", undefined).then((door) => {
      expect(door.isFakeSharepointEnabled()).toBe(false);
      expect(door.fakeSharepointBaseUrl()).toBeNull();
    });
  });

  it("opens in development when a URL is set", async () => {
    const door = await loadWith("development", "http://localhost:4400");

    expect(door.isFakeSharepointEnabled()).toBe(true);
    expect(door.fakeSharepointBaseUrl()).toBe("http://localhost:4400");
  });

  it("opens in test mode too, so the suite can drive it", async () => {
    const door = await loadWith("test", "http://localhost:4400");

    expect(door.isFakeSharepointEnabled()).toBe(true);
  });

  it("STAYS SHUT in production even with the URL set", async () => {
    // The whole point. A copied .env carries the variable across; MODE is
    // what refuses it, and neither condition alone would.
    const door = await loadWith("production", "http://localhost:4400");

    expect(door.isFakeSharepointEnabled()).toBe(false);
    expect(door.fakeSharepointBaseUrl()).toBeNull();
  });

  it("stays shut in production with a plausible-looking remote URL", async () => {
    // Not only localhost. A URL that looks like a real service is the more
    // dangerous shape, because it would not stand out in a config review.
    const door = await loadWith("production", "https://graph.internal.example.com");

    expect(door.isFakeSharepointEnabled()).toBe(false);
  });
});
