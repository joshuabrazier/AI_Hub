import { requireUser } from "@/lib/auth/session-auth-server";
import { MeetingPromptWindow } from "@/features/transcription/components/meeting-prompt-window";

// -------------------------------------------------------------------
// The in-meeting prompt, as its own window.
//
// Opened with window.open from the app, and the reason it is a top-level
// route rather than one under /admin, /manage or /portal is that it has to
// OUTLIVE the page that opened it. A window survives its opener closing;
// that is the whole point of it existing.
//
// GUARDED HERE, IN THE PAGE. The proxy matcher covers the three areas and
// this is deliberately outside them, so this call is the outer gate rather
// than a second opinion. requireUser also carries the two-factor check, so a
// session that has not satisfied it cannot reach this by opening the URL.
//
// There is no navbar or sidebar: it is in isChromelessRoute. Nothing here
// renders a shell, because the window is 440px wide and a sidebar in it
// would be absurd.
// -------------------------------------------------------------------
export default async function MeetingPromptPage() {
  await requireUser();

  return <MeetingPromptWindow />;
}
