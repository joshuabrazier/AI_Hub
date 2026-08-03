import TermsAndConditionsPage from "@/features/terms-conditions/terms-and-conditions-page";

// Renders admin-editable site content read from the DB, so render on demand
// rather than prerendering at build time.
export const dynamic = "force-dynamic";

export default async function TermsAndConditions() {
  return <TermsAndConditionsPage />;
}
