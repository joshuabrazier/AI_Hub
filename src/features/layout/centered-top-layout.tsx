import { PushStatusProvider } from "@/features/push/push-status-context";

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
// -------------------------------------------------------------------
export default function CenteredTopLayout({ children }: { children: React.ReactNode }) {
  return (
    <PushStatusProvider>
      <section className="flex min-h-[calc(100vh-5rem)] flex-col text-foreground">
        <div className="mx-auto w-full max-w-8xl flex-1">{children}</div>
      </section>
    </PushStatusProvider>
  );
}
