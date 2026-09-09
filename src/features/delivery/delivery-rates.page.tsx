import Link from "next/link";

import { ArrowLeft } from "lucide-react";

import { Button } from "@/components/ui/button";
import PortalPage from "@/features/layout/portal-page";
import { requireUserRole } from "@/lib/auth/session-auth-server";
import { USER_ROLES } from "@/lib/data/kysely-database-types";
import { formatIsoDate } from "@/lib/format";
import { ROUTES } from "@/lib/routes";

import { RatesHistoryList } from "./components/rates-history-list";
import { RatesOverviewTable } from "./components/rates-overview-table";
import { getUserRateHistoryService, getUserRatesOverviewService } from "./delivery-rates.service";

// -------------------------------------------------------------------
// ONE PAGE FOR TWO ROUTES, the id telling them apart:
//
//   /admin/rates            everybody, with the rate in force today in each
//                           of the three bands
//   /admin/rates/<userId>   one person's whole history
//
// ADMIN ONLY, and this pair is where that is least negotiable: a charge rate
// is a client's price and a cost rate is a pay proxy. It is why the rate DTOs
// do not use the module's money-by-absence convention - there is only one
// audience, so a non-admin is refused the whole object rather than handed a
// hollow one. The guard is repeated here anyway; the service checks again,
// and neither layer is load-bearing alone.
//
// `asAtDate` is on the DTO and belongs in the heading. "Current" is a
// question about a day, and a screen that cannot say which day it resolved
// leaves a rate starting next week looking like a missing one.
// -------------------------------------------------------------------
export default async function DeliveryRatesPage({ userId }: { userId?: string }) {
  await requireUserRole([USER_ROLES.ADMIN]);

  if (userId) {
    const history = await getUserRateHistoryService(userId);

    return (
      <PortalPage
        // A person's name, which this app de-identifies for dormant
        // accounts - so it can be null and the fallback has to be a
        // sentence rather than an empty heading.
        title={history.name ?? "Rate history"}
        description={
          history.email
            ? `Every rate on record for ${history.email}, newest start date first.`
            : "Every rate on record for this person, newest start date first."
        }
        actions={
          <Button asChild variant="outline">
            <Link href={ROUTES.ADMIN_RATES}>
              <ArrowLeft size={16} aria-hidden="true" />
              All rates
            </Link>
          </Button>
        }
      >
        <RatesHistoryList history={history} />
      </PortalPage>
    );
  }

  const overview = await getUserRatesOverviewService();

  return (
    <PortalPage
      title="Rates"
      // The date is not decoration. Every figure in the table is the rate in
      // force on this day, so a rise that starts next quarter is not in it -
      // it is on the person's history, and without the date on screen its
      // absence here reads as a missing rate.
      description={`What each person is charged out at and what they cost, in each of the three bands, as at ${formatIsoDate(overview.asAtDate)}. A rate starting later than today is on that person's history rather than here.`}
    >
      <div className="space-y-4">
        <RatesOverviewTable people={overview.people} />

        <p className="text-sm text-muted-foreground">
          Changing a rate never restates a figure already reported: every hour logged keeps the rate it was
          charged at, and a new rate covers the work done on or after its start date.
        </p>
      </div>
    </PortalPage>
  );
}
