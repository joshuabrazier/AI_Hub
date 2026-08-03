import Link from "next/link";
import { ArrowRight, ShieldCheck, UsersRound } from "lucide-react";

import { StatusBadge } from "@/components/status-badge";
import { Card, CardContent } from "@/components/ui/card";
import { ROUTES } from "@/lib/routes";

import type { ManagedTeamDTO } from "../manage-teams.types";

// -------------------------------------------------------------------
// One team in the manager's list. The link carries the team id for routing
// only - the detail page re-checks it against the caller's scope before it
// reads anything.
// -------------------------------------------------------------------
export function ManagedTeamCard({ team }: { team: ManagedTeamDTO }) {
  return (
    <Card className="shadow-sm transition-shadow hover:shadow-md">
      <CardContent className="flex h-full flex-col gap-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate font-heading text-lg font-semibold leading-snug text-foreground">
              {team.name}
            </h2>
            <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
              {team.description || "No description"}
            </p>
          </div>
          <StatusBadge active={team.isActive} />
        </div>

        <dl className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
          <div className="flex items-center gap-2">
            <UsersRound size={16} aria-hidden="true" className="text-signal" />
            <dt className="text-muted-foreground">Members</dt>
            <dd className="font-mono tabular-nums font-medium text-foreground">{team.memberCount}</dd>
          </div>
          <div className="flex items-center gap-2">
            <ShieldCheck size={16} aria-hidden="true" className="text-signal" />
            <dt className="text-muted-foreground">Managers</dt>
            <dd className="font-mono tabular-nums font-medium text-foreground">{team.managerCount}</dd>
          </div>
        </dl>

        <Link
          href={ROUTES.manageTeam(team.id)}
          className="mt-auto inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
        >
          View team
          <ArrowRight size={16} aria-hidden="true" />
        </Link>
      </CardContent>
    </Card>
  );
}
