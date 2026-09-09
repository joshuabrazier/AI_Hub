// -------------------------------------------------------------------
// How long to keep asking Teams for a transcript that has not appeared.
//
// Pure, and separated from the sweep because it is the one judgement in that
// loop and the failure it prevents is invisible: a meeting nobody actually
// transcribed being polled forever, several Graph calls at a time, against a
// throttle shared with the SharePoint crawl and the meeting import.
//
// THAT IS THE COMMON CASE, NOT THE RARE ONE. The prompt asks somebody to
// start transcription; it cannot make them. So most armed meetings where the
// person got distracted will never produce anything, and the window has to
// close on them cleanly rather than treating "not yet" as "keep trying".
// -------------------------------------------------------------------

// Teams has to finalise a transcript after a meeting ends. Asking straight
// away spends a call on a certain miss.
export const FIRST_TRY_AFTER_MINUTES = 5;

// Attempts bound the common case: transcription was never started, and no
// amount of asking will change that.
export const MAX_ATTEMPTS = 8;

// Wall-clock bounds the case attempts cannot: the sweep stopping for a day
// and resuming, where a row could otherwise sit at two attempts and be
// retried long after anybody cared.
export const GIVE_UP_HOURS = 12;

export function isAutoImportWindowClosed(input: {
  // Attempts made BEFORE the one about to happen.
  attempts: number;
  endsAt: Date;
  now: Date;
}): boolean {
  // The attempt about to be made is the one that counts, so a row on its
  // last try settles on this pass rather than needing one more sweep to
  // notice it is finished.
  if (input.attempts + 1 >= MAX_ATTEMPTS) return true;

  return input.now.getTime() - input.endsAt.getTime() > GIVE_UP_HOURS * 60 * 60 * 1000;
}
