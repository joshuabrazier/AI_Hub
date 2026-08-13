import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AiChatMarkdown } from "./components/ai-chat-markdown";

// -------------------------------------------------------------------
// What a model's reply actually turns into.
//
// Rendering to static markup and asserting on the RESULT is the point:
// every claim in this file is about output, not about which library was
// used or how it was configured. A future change that swaps the renderer,
// adds rehype-raw, or drops the URL allowlist fails here rather than in
// somebody's browser.
//
// The hostile cases matter more than the formatting ones. A model repeats
// back whatever it was given, so anything a user can paste into a message
// can come back inside a reply and be rendered by this component.
// -------------------------------------------------------------------
const render = (markdown: string) => renderToStaticMarkup(createElement(AiChatMarkdown, { content: markdown }));

describe("AiChatMarkdown renders formatting", () => {
  it("turns emphasis into real elements", () => {
    expect(render("**bold text**")).toContain("<strong");
    expect(render("*italic text*")).toContain("<em");
    expect(render("***bold and italic***")).toMatch(/<em[^>]*><strong|<strong[^>]*><em/);
    expect(render("~~strikethrough~~")).toContain("<del");
  });

  it("renders headings, rules, quotes and code", () => {
    expect(render("# Heading 1")).toContain("<h1");
    expect(render("###### Heading 6")).toContain("<h6");
    expect(render("---")).toContain("<hr");
    expect(render("> quoted")).toContain("<blockquote");
    expect(render("`inline code`")).toContain("<code");
    expect(render("```js\nconst a = 1;\n```")).toContain("<pre");
  });

  it("renders both kinds of list, nested, plus task lists", () => {
    expect(render("- one\n- two\n  - nested")).toContain("<ul");
    expect(render("1. one\n2. two")).toContain("<ol");

    const tasks = render("- [ ] unchecked\n- [x] checked");
    expect(tasks).toContain('type="checkbox"');
    expect(tasks).toContain("checked=");
    // Read-only: this is a transcript, not a form, so a tick would imply
    // state that is saved nowhere.
    expect(tasks).toContain("disabled=");
  });

  it("renders GFM tables and footnotes", () => {
    const table = render("| a | b |\n|---|---|\n| 1 | 2 |");
    expect(table).toContain("<table");
    expect(table).toContain("<th");
    expect(table).toContain("<td");

    const footnote = render("text with a note[^1]\n\n[^1]: the note");
    expect(footnote).toContain("<sup");
    expect(footnote).toContain("the note");
  });

  it("leaves subscript syntax alone rather than mangling it", () => {
    // GFM would read a single tilde as strikethrough, turning H~2~O into a
    // struck-through 2. singleTilde:false keeps it literal, which is the
    // less wrong of the two - and `~~` still strikes through.
    const output = render("H~2~O");
    expect(output).not.toContain("<del");
    expect(output).toContain("H~2~O");
  });
});

describe("AiChatMarkdown is safe with hostile input", () => {
  it("never parses raw HTML out of a reply", () => {
    // The single most important assertion here. If this ever fails,
    // something added rehype-raw and a reply can now inject markup.
    const output = render('<script>alert(1)</script><img src=x onerror="alert(1)">');

    // No real tags: what matters is that none of this became an ELEMENT.
    expect(output).not.toContain("<script");
    expect(output).not.toContain("<img");

    // The words still appear, because the reply is shown as it was written
    // - but every delimiter around them is entity-encoded, so the browser
    // renders visible text and never an attribute. Asserting on the
    // escaping rather than on the absence of the word "onerror" is the
    // distinction that makes this test mean something.
    expect(output).toContain("&lt;script&gt;");
    expect(output).toContain("onerror=&quot;");
  });

  it("does not let an iframe or object through either", () => {
    const output = render('<iframe src="https://evil.example"></iframe>');

    expect(output).not.toContain("<iframe");
    expect(output).toContain("&lt;iframe");
  });

  it("neutralises a javascript: link", () => {
    const output = render("[click me](javascript:alert(1))");

    expect(output).not.toContain("javascript:");
    // Rendered as plain text rather than a dead <a>, so nothing looks
    // clickable that is not.
    expect(output).toContain("click me");
    expect(output).not.toContain("<a ");
  });

  it("neutralises a data: URL link", () => {
    const output = render("[x](data:text/html;base64,PHNjcmlwdD48L3NjcmlwdD4=)");

    expect(output).not.toContain("data:text/html");
  });

  it("keeps ordinary links, and opens them safely", () => {
    const output = render("[link text](https://example.com)");

    expect(output).toContain('href="https://example.com"');
    expect(output).toContain('target="_blank"');
    // noopener stops the opened page reaching back through window.opener.
    expect(output).toContain("noopener");
  });

  it("does not fetch remote images", () => {
    // A reply cannot contain a real picture - the model returns text - so
    // an image URL is either invented or reflected from user input.
    // Rendering it would fetch a third-party URL from inside a private
    // conversation, leaking the reader's IP and the timing of the read,
    // and a URL whose path encodes conversation text would exfiltrate it
    // silently. Shown as a labelled link instead.
    const output = render("![secret diagram](https://evil.example/track.png)");

    expect(output).not.toContain("<img");
    expect(output).toContain("secret diagram");
    expect(output).toContain('href="https://evil.example/track.png"');
  });
});
