import { describe, expect, it } from "vitest";

import { safeUrl } from "./safe-url";

describe("safeUrl", () => {
  it("passes through the protocols a link may legitimately use", () => {
    expect(safeUrl("https://example.com/a?b=c#d")).toBe("https://example.com/a?b=c#d");
    expect(safeUrl("http://example.com")).toBe("http://example.com");
    expect(safeUrl("mailto:support@example.com")).toBe("mailto:support@example.com");
    expect(safeUrl("tel:+61400000000")).toBe("tel:+61400000000");
  });

  it("allows relative URLs, which cannot execute", () => {
    expect(safeUrl("/portal/ai-chat")).toBe("/portal/ai-chat");
    expect(safeUrl("../thing")).toBe("../thing");
    expect(safeUrl("#anchor")).toBe("#anchor");
  });

  it("rejects the script-bearing protocols", () => {
    // The whole reason this function exists: a model can be talked into
    // repeating one of these back inside a markdown link.
    expect(safeUrl("javascript:alert(1)")).toBe("");
    expect(safeUrl("vbscript:msgbox(1)")).toBe("");
    expect(safeUrl("data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==")).toBe("");
    expect(safeUrl("file:///etc/passwd")).toBe("");
  });

  it("is not fooled by casing or leading whitespace", () => {
    // URL parsing lower-cases the protocol and strips leading control
    // characters, so these normalise to javascript: rather than sneaking
    // past a naive string comparison.
    expect(safeUrl("JavaScript:alert(1)")).toBe("");
    expect(safeUrl("  javascript:alert(1)")).toBe("");
    expect(safeUrl("JAVASCRIPT:alert(1)")).toBe("");
  });

  it("rejects anything unparseable rather than guessing", () => {
    expect(safeUrl("http://[")).toBe("");
  });
});
