import DeliveryProjectSetupPage from "@/features/delivery/delivery-project-setup.page";

// No project id: the setup page's create half. A STATIC segment, which Next
// resolves ahead of [projectId], so this is never read as a board.
export default async function AdminNewProject() {
  return <DeliveryProjectSetupPage />;
}
