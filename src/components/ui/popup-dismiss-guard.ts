// -------------------------------------------------------------------
// Shared outside-interaction guard for modal popups (Dialog, Sheet).
//
// Radix dismisses a modal popup on any pointer/focus interaction outside its
// content. Two things make that misfire for us and close a popup the user
// didn't mean to close:
//
//  1. A portaled Select (or other popper) dropdown renders OUTSIDE the popup's
//     DOM subtree. Interacting with the dropdown - or clicking blank space to
//     dismiss it while it's open - reads as "outside" and closes the popup too.
//
//  2. A modal Select sets `pointer-events: none` on <body> while open, so a
//     click on blank space INSIDE the popup can resolve its target to <body>
//     and also read as "outside".
//
// `isInsidePopupInteraction` returns true when the popup should be kept open.
// Callers apply it in onInteractOutside and event.preventDefault() when true.
// -------------------------------------------------------------------

type InteractOutsideEvent = {
  detail: { originalEvent: Event };
  target: EventTarget | null;
};

export function isInsidePopupInteraction(event: InteractOutsideEvent, contentEl: HTMLElement | null): boolean {
  const target = event.target as Element | null;

  // A dropdown/popover is being interacted with, or one is currently open
  // anywhere - the click is meant to dismiss that, not the popup.
  const poppers = "[data-slot='select-content'],[data-slot='popover-content']";
  if (target?.closest(poppers) || document.querySelector(poppers)) {
    return true;
  }

  // The pointer landed geometrically inside the popup box - treat as inside
  // regardless of what the DOM reports as the target (see note 2 above).
  const original = event.detail.originalEvent as Event & { clientX?: number; clientY?: number };
  if (
    contentEl &&
    typeof original?.clientX === "number" &&
    typeof original?.clientY === "number" &&
    (original.clientX !== 0 || original.clientY !== 0)
  ) {
    const r = contentEl.getBoundingClientRect();
    return (
      original.clientX >= r.left && original.clientX <= r.right && original.clientY >= r.top && original.clientY <= r.bottom
    );
  }

  return false;
}
