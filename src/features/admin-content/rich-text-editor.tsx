"use client";

import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import { Bold, Italic, Heading2, Heading3, List, ListOrdered, Link as LinkIcon } from "lucide-react";
import { cn } from "@/lib/utils";

// -------------------------------------------------------------------
// RichTextEditor
// TipTap WYSIWYG editor with a small formatting toolbar. Emits HTML via
// onChange; the HTML is sanitized again on the public side (RichText).
// -------------------------------------------------------------------
type ToolbarButtonProps = {
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  label: string;
  children: React.ReactNode;
};

function ToolbarButton({ onClick, active, disabled, label, children }: ToolbarButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={active}
      className={cn(
        "flex size-8 items-center justify-center rounded-md text-foreground transition-colors hover:bg-muted disabled:opacity-50",
        active && "bg-muted text-primary",
      )}
    >
      {children}
    </button>
  );
}

export function RichTextEditor({
  value,
  onChange,
  disabled = false,
  ariaLabel,
  editorClassName,
}: {
  value: string;
  onChange: (html: string) => void;
  disabled?: boolean;
  ariaLabel?: string;
  // Extra classes for the editable area - e.g. a bounded height with its own
  // scroll (`max-h-[50vh] overflow-y-auto`) when the editor lives in a dialog.
  editorClassName?: string;
}) {
  const editor = useEditor({
    immediatelyRender: false,
    editable: !disabled,
    extensions: [
      StarterKit,
      Link.configure({
        openOnClick: false,
        autolink: true,
        // Restrict to safe protocols - blocks javascript:/data: links.
        protocols: ["http", "https", "mailto", "tel"],
      }),
    ],
    content: value,
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
    editorProps: {
      attributes: {
        ...(ariaLabel ? { "aria-label": ariaLabel, role: "textbox", "aria-multiline": "true" } : {}),
        class: cn(
          "min-h-48 w-full rounded-b-lg border border-t-0 border-input bg-background px-3 py-2 text-base outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
          "[&_h2]:mt-3 [&_h2]:text-xl [&_h2]:font-bold [&_h3]:mt-3 [&_h3]:text-lg [&_h3]:font-bold",
          "[&_ul]:list-disc [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:pl-6",
          "[&_a]:text-primary [&_a]:underline",
          "[&_p]:my-2",
          editorClassName,
        ),
      },
    },
  });

  if (!editor) return null;

  const setLink = (activeEditor: Editor) => {
    const previous = activeEditor.getAttributes("link").href as string | undefined;
    const url = window.prompt("Link URL", previous ?? "https://");
    if (url === null) return;
    if (url === "") {
      activeEditor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    activeEditor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1 rounded-t-lg border border-input bg-muted/40 p-1">
        <ToolbarButton label="Bold" onClick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive("bold")} disabled={disabled}>
          <Bold size={16} />
        </ToolbarButton>
        <ToolbarButton label="Italic" onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive("italic")} disabled={disabled}>
          <Italic size={16} />
        </ToolbarButton>
        <ToolbarButton label="Heading 2" onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} active={editor.isActive("heading", { level: 2 })} disabled={disabled}>
          <Heading2 size={16} />
        </ToolbarButton>
        <ToolbarButton label="Heading 3" onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} active={editor.isActive("heading", { level: 3 })} disabled={disabled}>
          <Heading3 size={16} />
        </ToolbarButton>
        <ToolbarButton label="Bullet list" onClick={() => editor.chain().focus().toggleBulletList().run()} active={editor.isActive("bulletList")} disabled={disabled}>
          <List size={16} />
        </ToolbarButton>
        <ToolbarButton label="Numbered list" onClick={() => editor.chain().focus().toggleOrderedList().run()} active={editor.isActive("orderedList")} disabled={disabled}>
          <ListOrdered size={16} />
        </ToolbarButton>
        <ToolbarButton label="Link" onClick={() => setLink(editor)} active={editor.isActive("link")} disabled={disabled}>
          <LinkIcon size={16} />
        </ToolbarButton>
      </div>

      <EditorContent editor={editor} />
    </div>
  );
}
