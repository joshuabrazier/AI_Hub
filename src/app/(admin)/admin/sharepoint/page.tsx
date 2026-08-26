import SharepointPage from "@/features/sharepoint/sharepoint.page";

// Admin only, and there is no manage or portal equivalent. A document
// library is company-wide rather than team-scoped, so there is nothing for
// a manager to be scoped to.
export default async function AdminSharepoint() {
  return <SharepointPage />;
}
