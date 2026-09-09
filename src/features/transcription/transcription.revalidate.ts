import "server-only";

import { revalidatePath } from "next/cache";

import { ROUTES } from "@/lib/routes";

// -------------------------------------------------------------------
// Refresh the transcription screens.
//
// ITS OWN MODULE TO BREAK A CYCLE, which is the whole reason it is not still
// a private function in the service. transcription.service.ts imports the
// filing service (a finished transcription files itself), and the filing
// service needs to refresh the same screens after a manual retry - so
// importing it back would make the two files depend on each other. ESM
// tolerates that and then fails in ways that depend on which module was
// loaded first, which is not a debugging session anybody wants.
//
// THE FEATURE IS MOUNTED IN ALL THREE AREAS, so a change has to refresh all
// three: which one the caller is looking at is not knowable from here.
// -------------------------------------------------------------------
export function revalidateTranscriptionViews(): void {
  revalidatePath(ROUTES.ADMIN_TRANSCRIPTION);
  revalidatePath(ROUTES.MANAGE_TRANSCRIPTION);
  revalidatePath(ROUTES.PORTAL_TRANSCRIPTION);
}
