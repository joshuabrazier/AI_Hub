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
// THE BAND STAYS. It was briefly removed - the argument being that a header
// is a set of labels rather than data, so the rule under it should do the
// separating and the labels themselves should recede. Two of those things
// are true and the conclusion was not: with no fill, a wide table's header
// stops being a distinct object and the first data row reads as part of it.
//
// `bg-secondary` rather than the `bg-primary/10` it was. Both are tints of
// the brand hue and this one is the token that exists for a quiet surface,
// so the band no longer changes colour if `--primary` is re-tinted for a
// different brand.
// -------------------------------------------------------------------
function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return (
    <thead
      data-slot="table-header"
      className={cn("bg-secondary [&_tr]:border-b [&_tr]:hover:bg-transparent", className)}
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
// A COLUMN HEADING IS A LABEL, and it is set one size down and one weight up
// from the data - not in a different typeface.
//
// It was briefly 11px Plex Mono, uppercase, letter-spaced and muted, on the
// argument that a heading should recede so the figures lead. It receded too
// far and it took the whole table's character with it: tracked mono
// uppercase reads as generated, and at 11px muted on a tinted band a long
// column name was genuinely harder to read than the numbers under it.
//
// `text-xs font-semibold text-foreground` on the tinted band does the same
// job honestly - smaller than the rows, heavier than the rows, and the band
// separates them. The DOM text keeps its own case either way, so nothing
// here changes what a screen reader says.
// -------------------------------------------------------------------
function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        "h-9 px-2 text-left align-middle text-xs font-semibold whitespace-nowrap text-foreground [&:has([role=checkbox])]:pr-0",
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
