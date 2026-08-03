import AboutPage from "@/features/about/about-page";

// Renders admin-editable site content read from the DB, so render on demand
// rather than prerendering at build time (which needs a DB connection from the
// CI runner and would bake stale content).
export const dynamic = "force-dynamic";

export default async function About() {
  return <AboutPage />;
}
