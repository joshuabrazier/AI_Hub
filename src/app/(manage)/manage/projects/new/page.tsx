import DeliveryProjectSetupPage from "@/features/delivery/delivery-project-setup.page";

// No project id: the setup page's create half, in the manager's own area. A
// STATIC segment, which Next resolves ahead of [projectId], so this is never
// read as a board.
//
// The page guards on [ADMIN, MANAGER] through createProjectService and the
// reads it makes; this file is routing and nothing else.
export default async function ManageNewProject() {
  return <DeliveryProjectSetupPage />;
}
