import DeliveryProjectSetupPage from "@/features/delivery/delivery-project-setup.page";

// The project id is a routing parameter and nothing more. The feature page
// guards on admin and its services re-check the project.
export default async function AdminProjectSetup({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;

  return <DeliveryProjectSetupPage projectId={projectId} />;
}
