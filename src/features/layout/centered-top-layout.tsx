import { PushStatusProvider } from "@/features/push/push-status-context";
import { MeetingPrompt } from "@/features/transcription/components/meeting-prompt";

// -------------------------------------------------------------------
// CenteredTopLayout
// Full-height wrapper for portal pages that own their own vertical rhythm.
// Sized to the viewport minus the fixed navbar.
//
// It also carries PushStatusProvider, because all three authenticated areas
// use this one component - so mounting it here covers admin, manage and
// portal without three copies that could drift. Detection is client-only
// and touches no server, so it costs nothing on a page that never asks
// about notifications.
//
// MeetingPrompt is here for the same reason and needs the same care for a
// different one: it is the only thing in the app that appears without being
// asked for. It polls Graph while a tab is VISIBLE, goes quiet permanently
// once Graph says the scope is missing, and shows nothing at all unless
// presence says a call is actually up - so a person who never has Teams open
// pays two Graph calls a minute and sees nothing, and a tenant that has not
// consented pays one and then stops.
// -------------------------------------------------------------------
export default function CenteredTopLayout({ children }: { children: React.ReactNode }) {
  return (
    <PushStatusProvider>
      <section className="flex min-h-[calc(100vh-5rem)] flex-col text-foreground">
        <div className="mx-auto w-full max-w-8xl flex-1">{children}</div>
      </section>

      <MeetingPrompt />
    </PushStatusProvider>
  );
}
