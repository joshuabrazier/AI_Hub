import PrivacyPolicyPage from "@/features/privacy-policy/privacy-policy-page";

// Renders admin-editable site content read from the DB, so render on demand
// rather than prerendering at build time.
export const dynamic = "force-dynamic";

export default async function PrivacyPolicy() {
  return <PrivacyPolicyPage />;
}
