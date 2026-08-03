import PortalPage from "@/features/layout/portal-page";
import { StandardTablePage } from "@/features/layout/standard-table-page";

import { getClosureDaysAction } from "./admin-closure-days.actions";
import { ClosureDaysTable } from "./table/closure-days-table";

// -------------------------------------------------------------------
// Admin Closure Days Page
// Dates on which nothing runs. Every session on one of these dates shows as
// cancelled on every schedule, without its stored status being touched.
// -------------------------------------------------------------------
export default async function AdminClosureDaysPage() {
  const response = await getClosureDaysAction();

  return (
    <StandardTablePage response={response}>
      {(days) => (
        <PortalPage
          eyebrow="Admin"
          title="Closure days"
          description="Dates when no classes run. Sessions on these dates show as cancelled until the day is removed."
        >
          <ClosureDaysTable days={days} />
        </PortalPage>
      )}
    </StandardTablePage>
  );
}
