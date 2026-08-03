export default function CenteredLayout({ children }: { children: React.ReactNode }) {
  return (
    <section className="flex min-h-[calc(100vh-5rem)] items-center justify-center text-secondary">{children}</section>
  );
}
