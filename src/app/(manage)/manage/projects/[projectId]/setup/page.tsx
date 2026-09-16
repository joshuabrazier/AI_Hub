import DeliveryProjectSetupPage from "@/features/delivery/delivery-project-setup.page";

// The project id is a routing parameter and nothing more. The services behind
// the page re-check it: a manager who does not LEAD this project is refused
// by requireProjectStructureAccess, and one who is not on it at all gets
// notFound() from requireProjectAccess rather than a message confirming it
// exists.
export default async function ManageProjectSetup({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;

  return <DeliveryProjectSetupPage projectId={projectId} />;
}
