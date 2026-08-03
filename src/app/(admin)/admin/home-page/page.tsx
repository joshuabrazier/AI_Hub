import AdminHomePage from "@/features/admin-content/admin-home-page.page";

// This screen reads the stored home page blocks, so it must never be served
// from a build-time render: an admin who has just saved has to see what is
// actually stored, not what was there when the app was built.
export const dynamic = "force-dynamic";

export default async function AdminHomePageRoute() {
  return <AdminHomePage />;
}
