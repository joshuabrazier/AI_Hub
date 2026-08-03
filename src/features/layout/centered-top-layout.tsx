// -------------------------------------------------------------------
// CenteredTopLayout
// Full-height wrapper for portal pages that own their own vertical rhythm.
// Sized to the viewport minus the fixed navbar.
// -------------------------------------------------------------------
export default function CenteredTopLayout({ children }: { children: React.ReactNode }) {
  return (
    <section className="flex min-h-[calc(100vh-5rem)] flex-col text-foreground">
      <div className="mx-auto w-full max-w-8xl flex-1">{children}</div>
    </section>
  );
}
