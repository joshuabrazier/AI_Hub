"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

function Table({ className, ...props }: React.ComponentProps<"table">) {
  return (
    <div
      data-slot="table-container"
      className="relative w-full overflow-x-auto"
    >
      <table
        data-slot="table"
        className={cn("w-full caption-bottom text-sm", className)}
        {...props}
      />
    </div>
  )
}

// -------------------------------------------------------------------
// NO TINTED BAND. This was `bg-primary/10`, so every table in the app wore a
// teal stripe across the top - which alongside the teal rail was the second
// large block of brand colour on screen, and it competed with the one mark
// that is supposed to mean something.
//
// A HEADER IS A SET OF LABELS, NOT DATA, and it should read that way: the
// rule under it is what separates it from the rows, and the labels themselves
// recede. See TableHead for the type treatment that does the receding.
// -------------------------------------------------------------------
function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return (
    <thead
      data-slot="table-header"
      className={cn("[&_tr]:border-b [&_tr]:hover:bg-transparent", className)}
      {...props}
    />
  )
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return (
    <tbody
      data-slot="table-body"
      className={cn("[&_tr:last-child]:border-0", className)}
      {...props}
    />
  )
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn(
        "border-t bg-muted/50 font-medium [&>tr]:last:border-b-0",
        className
      )}
      {...props}
    />
  )
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        // `bg-muted/50` was invisible: --muted is #f6fafb, two steps off
        // white, and half of it on white is nothing at all - so rows had a
        // hover state in the code and none on the screen. --accent is the
        // token this palette designates as the hover SURFACE, which is what
        // this is.
        "border-b transition-colors hover:bg-accent/60 has-aria-expanded:bg-accent/60 data-[state=selected]:bg-accent",
        className
      )}
      {...props}
    />
  )
}

// -------------------------------------------------------------------
// A COLUMN HEADING IS AN EYEBROW. Set in the mono utility face, small,
// tracked and muted - the same treatment the rail's section labels and the
// page header's metric label get, because they are all doing the same job:
// naming something rather than being the something.
//
// It used to be `text-foreground font-medium` at the body size, so a heading
// carried the same weight and colour as the data underneath it and the eye
// had to find the rule to tell them apart. Making the labels quieter is what
// lets the figures be the loudest thing in a table, which is the entire
// point of one.
// -------------------------------------------------------------------
function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        "h-9 px-2 text-left align-middle font-mono text-[0.6875rem] font-medium tracking-[0.08em] whitespace-nowrap text-muted-foreground uppercase [&:has([role=checkbox])]:pr-0",
        className
      )}
      {...props}
    />
  )
}

function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return (
    <td
      data-slot="table-cell"
      className={cn(
        "p-2 align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0",
        className
      )}
      {...props}
    />
  )
}

function TableCaption({
  className,
  ...props
}: React.ComponentProps<"caption">) {
  return (
    <caption
      data-slot="table-caption"
      className={cn("mt-4 text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
}
