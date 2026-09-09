import DeliveryRatesPage from "@/features/delivery/delivery-rates.page";

// The user id is a routing parameter and nothing more. The feature page
// guards on admin, and the service answers notFound() for an id that
// resolves to nobody.
export default async function AdminUserRates({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const { userId } = await params;

  return <DeliveryRatesPage userId={userId} />;
}
