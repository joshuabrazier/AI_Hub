"use client";

import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { safeUrl } from "@/lib/safe-url";
import { cn } from "@/lib/utils";

// -------------------------------------------------------------------
// Markdown for something a model wrote.
//
// SHARED, and deliberately not named for one feature: an assistant reply
// and a meeting summary are the same kind of thing - text this app asked a
// model to produce - and they need the same treatment for the same reason.
// A second copy of this file would be a second place for one of the three
// controls below to be quietly dropped.
//
// HOW THIS KEEPS THE "NEVER RENDER MODEL OUTPUT AS HTML" RULE
//
// The rule that matters here is that a model repeats back whatever it was
// given, so its output is untrusted text - and this app must never hand it
// to the browser as markup. That rule is intact, because react-markdown does
// not produce an HTML string at any point: it parses to an AST and renders
// REACT ELEMENTS from it. There is no dangerouslySetInnerHTML anywhere in
// this path, and text still reaches the DOM as a text node, escaped by
// React exactly as it was before.
//
// Three things are load-bearing in keeping it that way, and none is
// decorative:
//
//   1. NO rehype-raw, and no `skipHtml={false}` equivalent. Raw HTML in the
//      markdown source is left as literal text. Adding rehype-raw would
//      parse `<script>` out of a reply and undo the entire point of this
//      file. If a future change seems to need it, it does not.
//   2. urlTransform below is an explicit protocol ALLOWLIST. Without it,
//      `[click](javascript:...)` becomes a working script link.
//   3. Images are rendered as LINKS, not fetched. See the note on `img`.
//
// NOTHING A PERSON TYPED GOES THROUGH THIS. What somebody wrote is shown
// exactly as they wrote it - if they write **stars** they meant stars, and
// silently reformatting a person's own words is both surprising and a way
// to make two different inputs look identical. Only model output is
// markdown, which is also what the model was asked to emit.
// -------------------------------------------------------------------

export function ModelMarkdown({ content, className }: { content: string; className?: string }) {
  return (
    <div className={cn("text-sm text-foreground", className)}>
      <Markdown
        remarkPlugins={[
          [
            remarkGfm,
            {
              // GFM lets a SINGLE tilde mean strikethrough as well as a
              // double one. Turning that off means `H~2~O` stays literal
              // text instead of rendering as a struck-through 2, which is
              // the less wrong of the two outcomes - subscript is not a
              // GFM feature and there is nothing here that can make it one
              // without breaking `~~strikethrough~~`.
              singleTilde: false,
            },
          ],
        ]}
        urlTransform={safeUrl}
        components={{
          // Sizes step down but stay close to body text: these are headings
          // inside a chat bubble, not a document, and a reply that opens
          // with an `# H1` should not shout.
          h1: ({ children }) => <h1 className="mt-4 mb-2 text-base font-semibold first:mt-0">{children}</h1>,
          h2: ({ children }) => <h2 className="mt-4 mb-2 text-base font-semibold first:mt-0">{children}</h2>,
          h3: ({ children }) => <h3 className="mt-3 mb-1.5 text-sm font-semibold first:mt-0">{children}</h3>,
          h4: ({ children }) => <h4 className="mt-3 mb-1.5 text-sm font-semibold first:mt-0">{children}</h4>,
          h5: ({ children }) => <h5 className="mt-3 mb-1.5 text-sm font-semibold first:mt-0">{children}</h5>,
          h6: ({ children }) => (
            <h6 className="mt-3 mb-1.5 text-sm font-semibold text-muted-foreground first:mt-0">{children}</h6>
          ),

          p: ({ children }) => <p className="my-2 leading-relaxed break-words first:mt-0 last:mb-0">{children}</p>,

          strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
          em: ({ children }) => <em className="italic">{children}</em>,
          del: ({ children }) => <del className="line-through opacity-70">{children}</del>,

          ul: ({ children }) => <ul className="my-2 ml-5 list-disc space-y-1 first:mt-0 last:mb-0">{children}</ul>,
          ol: ({ children }) => (
            <ol className="my-2 ml-5 list-decimal space-y-1 first:mt-0 last:mb-0">{children}</ol>
          ),
          li: ({ children, ...props }) => {
            // GFM task list items carry a checkbox as their first child.
            // Marking the item as unstyled stops a bullet sitting next to
            // the box, which is what makes a task list read as one.
            const isTask = "checked" in props && props.checked !== null && props.checked !== undefined;

            return <li className={cn("leading-relaxed", isTask && "list-none -ml-5")}>{children}</li>;
          },
          input: ({ checked, type }) =>
            type === "checkbox" ? (
              // Rendered read-only on purpose: this is a transcript of what
              // the model said, not a form. Letting somebody tick a box
              // here would imply a state that is saved nowhere.
              <input
                type="checkbox"
                checked={Boolean(checked)}
                readOnly
                disabled
                className="mr-2 align-middle accent-primary"
              />
            ) : null,

          blockquote: ({ children }) => (
            <blockquote className="my-2 border-l-2 border-border pl-3 text-muted-foreground first:mt-0 last:mb-0">
              {children}
            </blockquote>
          ),

          // `inline` is no longer passed in react-markdown v10. A fenced
          // block arrives wrapped in <pre>, so the presence of a newline is
          // the reliable signal - and `pre` below owns the block styling,
          // which is why this only ever styles the inline case.
          code: ({ children, className: codeClassName }) => {
            const text = String(children);
            const isBlock = text.includes("\n") || Boolean(codeClassName?.startsWith("language-"));

            if (isBlock) {
              return <code className="font-mono text-xs leading-relaxed">{children}</code>;
            }

            return (
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em] break-words">
                {children}
              </code>
            );
          },
          pre: ({ children }) => (
            // Scrolls inside itself. A long line of code must never be able
            // to widen the transcript and push the whole thread sideways.
            <pre className="my-2 overflow-x-auto rounded-lg border border-border bg-muted/50 p-3 first:mt-0 last:mb-0">
              {children}
            </pre>
          ),

          a: ({ href, children }) =>
            // urlTransform blanks anything that is not on the allowlist, so
            // a dropped link renders as plain text rather than a dead one
            // that still looks clickable.
            href ? (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="font-medium text-primary underline underline-offset-2 hover:no-underline"
              >
                {children}
              </a>
            ) : (
              <span>{children}</span>
            ),

          // IMAGES ARE NOT FETCHED, and that is a deliberate call rather
          // than an oversight.
          //
          // The model cannot produce a picture - it returns text - so any
          // image URL in a reply is either invented or reflected back from
          // something the user pasted. Rendering it would make the browser
          // fetch a third-party URL from inside a private conversation,
          // which leaks the reader's IP and the timing of them reading it,
          // and lets a URL whose PATH encodes conversation text exfiltrate
          // it silently on render.
          //
          // Shown as a labelled link instead: nothing is lost, the alt text
          // and the destination are both visible, and opening it is the
          // reader's decision. To render inline instead, replace this with
          // an <img src={src}> - and accept the above.
          img: ({ src, alt }) => {
            const href = typeof src === "string" ? safeUrl(src) : "";

            if (!href) return <span className="text-muted-foreground">{alt || "image"}</span>;

            return (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="font-medium text-primary underline underline-offset-2 hover:no-underline"
              >
                {alt ? `${alt} (image)` : "image"}
              </a>
            );
          },

          hr: () => <hr className="my-3 border-border" />,

          // Wrapped so a wide table scrolls on its own rather than
          // stretching the message column.
          table: ({ children }) => (
            <div className="my-2 overflow-x-auto first:mt-0 last:mb-0">
              <table className="w-full border-collapse text-left font-sans text-xs">{children}</table>
            </div>
          ),
          thead: ({ children }) => <thead className="border-b border-border">{children}</thead>,
          th: ({ children }) => <th className="px-2 py-1.5 font-semibold">{children}</th>,
          td: ({ children }) => <td className="border-t border-border px-2 py-1.5 align-top">{children}</td>,

          // GFM footnotes render as a section at the end of the reply.
          section: ({ children, ...props }) =>
            "data-footnotes" in props ? (
              <section className="mt-3 border-t border-border pt-2 text-xs text-muted-foreground">
                {children}
              </section>
            ) : (
              <section>{children}</section>
            ),
          sup: ({ children }) => <sup className="text-[0.7em]">{children}</sup>,
        }}
      >
        {content}
      </Markdown>
    </div>
  );
}
