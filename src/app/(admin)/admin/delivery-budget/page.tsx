import DeliveryBudgetPage from "@/features/delivery/delivery-budget.page";

// The budget report covers ONE project, and the project arrives as a query
// parameter because there is no across-projects read to build an index from.
// See ROUTES.ADMIN_DELIVERY_BUDGET.
export default async function AdminDeliveryBudget({
  searchParams,
}: {
  searchParams: Promise<{ projectId?: string }>;
}) {
  const { projectId } = await searchParams;

  return <DeliveryBudgetPage projectId={projectId} />;
}
