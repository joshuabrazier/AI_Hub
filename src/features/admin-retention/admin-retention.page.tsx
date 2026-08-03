import { ShieldAlert, ShieldCheck } from "lucide-react";

import PortalPage from "@/features/layout/portal-page";
import { StandardTablePage } from "@/features/layout/standard-table-page";
import { USER_ROLE_LABELS, type UserRole } from "@/lib/data/kysely-database-types";
import { envServer } from "@/lib/env-server";
import { formatDateTime, formatIsoDate } from "@/lib/format";

import { getDeidentifiedUsersAction, getRetentionCandidatesAction } from "./admin-retention.actions";
import { RETENTION_INACTIVE_MONTHS } from "./admin-retention.service";

// -------------------------------------------------------------------
// Data retention.
//
// A read-only view of the automatic monthly de-identification: who is queued
// for the next run, and who has already been processed. Nothing on this page
// performs the scrub - the scheduled job does, and only while the master
// switch is on.
// -------------------------------------------------------------------
export default async function AdminDataRetentionPage() {
  const [candidatesResponse, deidentifiedResponse] = await Promise.all([
    getRetentionCandidatesAction(),
    getDeidentifiedUsersAction(),
  ]);

  const jobEnabled = envServer.RETENTION_JOB_ENABLED;

  // The already-processed list is supporting detail, so a failure to load it
  // leaves the queue readable rather than blanking the page.
  const deidentified = deidentifiedResponse.success ? deidentifiedResponse.data : [];

  return (
    <StandardTablePage response={candidatesResponse}>
      {(candidates) => (
        <PortalPage
          eyebrow="Admin"
          title="Data retention"
          description={`Deactivated accounts with no sign-in and no session attendance for ${RETENTION_INACTIVE_MONTHS}+ months are de-identified automatically each month.`}
        >
          {/* Status of the automatic job. When off, this page is a preview. */}
          {jobEnabled ? (
            <div
              role="status"
              className="mb-6 flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200"
            >
              <ShieldAlert size={18} aria-hidden="true" className="mt-0.5 shrink-0" />
              <div>
                <p className="font-semibold">Automatic de-identification is ON.</p>
                <p className="mt-0.5">
                  The people listed below will be de-identified on the next monthly run. This removes their name,
                  contact details and sign-in credentials, and cannot be undone.
                </p>
              </div>
            </div>
          ) : (
            <div
              role="status"
              className="mb-6 flex items-start gap-3 rounded-xl border border-border bg-muted/40 p-4 text-sm text-muted-foreground"
            >
              <ShieldCheck size={18} aria-hidden="true" className="mt-0.5 shrink-0" />
              <div>
                <p className="font-semibold text-foreground">Preview only, nothing is de-identified.</p>
                <p className="mt-0.5">
                  Automatic de-identification is currently off. The people below are what the monthly job would
                  process once it is switched on.
                </p>
              </div>
            </div>
          )}

          {/* Queued: everybody who currently meets the rule. */}
          <section className="mb-10">
            <h2 className="mb-3 font-heading text-lg font-semibold text-foreground">
              {jobEnabled ? "Queued for de-identification" : "Would be de-identified"}
            </h2>
            {candidates.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nobody currently meets the {RETENTION_INACTIVE_MONTHS}-month rule. An account has to be deactivated
                and have had no sign-in and no session attendance for {RETENTION_INACTIVE_MONTHS}+ months.
              </p>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-border">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-border bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3 font-semibold">Name</th>
                      <th className="px-4 py-3 font-semibold">Email</th>
                      <th className="px-4 py-3 font-semibold">Role</th>
                      <th className="px-4 py-3 font-semibold">Account created</th>
                      <th className="px-4 py-3 font-semibold">Last sign-in</th>
                      <th className="px-4 py-3 font-semibold">Last session</th>
                    </tr>
                  </thead>
                  <tbody>
                    {candidates.map((candidate) => (
                      <tr key={candidate.userId} className="border-b border-border last:border-0">
                        <td className="px-4 py-3 font-medium text-foreground">{candidate.name}</td>
                        <td className="px-4 py-3 text-foreground">{candidate.email}</td>
                        <td className="px-4 py-3 text-foreground">
                          {USER_ROLE_LABELS[candidate.role as UserRole] ?? candidate.role}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">
                          {formatDateTime(candidate.createdAt)}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">
                          {candidate.lastSignInAt ? formatDateTime(candidate.lastSignInAt) : "Never"}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">
                          {/* A DATE column, so already a 'YYYY-MM-DD' string. */}
                          {candidate.lastSessionDate ? formatIsoDate(candidate.lastSessionDate) : "Never attended"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Already processed. Their identity is tombstoned, so there is
              nothing to show but when it happened. */}
          <section>
            <h2 className="mb-3 font-heading text-lg font-semibold text-foreground">Already de-identified</h2>
            {deidentified.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nobody has been de-identified yet.</p>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-border">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-border bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3 font-semibold">De-identified</th>
                      <th className="px-4 py-3 font-semibold">Account created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {deidentified.map((user) => (
                      <tr key={user.userId} className="border-b border-border last:border-0">
                        <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">
                          {formatDateTime(user.deidentifiedAt)}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">
                          {formatDateTime(user.createdAt)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </PortalPage>
      )}
    </StandardTablePage>
  );
}
