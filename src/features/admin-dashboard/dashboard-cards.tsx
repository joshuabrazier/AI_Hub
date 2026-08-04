import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { ArrowRight, Bell, LayoutPanelLeft, type LucideIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader } from "@/components/ui/card";
import { ROUTES } from "@/lib/routes";
import { cn } from "@/lib/utils";

import type { DashboardBroadcastDTO, DashboardTeamDTO } from "./admin-dashboard.types";

// -------------------------------------------------------------------
// Dashboard primitives
//
// BrandChip, StatTile and DashboardCard are the shared building blocks of
// every overview screen. They live here as components rather than as a copied
// class string: the chip used to be a BRAND_CHIP constant pasted into three
// files, and the three had already drifted (one had grown a gradient, the
// others had not). One component means one look, and a rebrand is one edit.
// -------------------------------------------------------------------

// The chip is a solid fill of the brand token with its paired foreground -
// never text-white, which would go unreadable the moment `primary` is
// re-tinted for a lighter brand.
const CHIP_SIZES = {
  sm: { box: "size-9 rounded-xl", icon: 18 },
  lg: { box: "size-12 rounded-2xl", icon: 24 },
} as const;

export type BrandChipSize = keyof typeof CHIP_SIZES;

export function BrandChip({
  icon: Icon,
  size = "sm",
  className,
}: {
  icon: LucideIcon;
  size?: BrandChipSize;
  className?: string;
}) {
  const chip = CHIP_SIZES[size];

  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center bg-primary text-primary-foreground shadow-sm",
        chip.box,
        className,
      )}
    >
      <Icon size={chip.icon} aria-hidden="true" />
    </span>
  );
}

// -------------------------------------------------------------------
// StatTile - one headline count.
//
// `href` is optional: a figure that has a page behind it becomes a link to it,
// and one that does not stays plain text. The whole tile is the target rather
// than a "view" affordance in the corner, so the hit area matches what looks
// clickable.
// -------------------------------------------------------------------
export function StatTile({
  icon,
  value,
  label,
  href,
}: {
  icon: LucideIcon;
  value: number | string;
  label: string;
  href?: string;
}) {
  const body = (
    <CardContent className="flex items-center gap-4">
      <BrandChip icon={icon} size="lg" />
      <div className="min-w-0">
        <p className="font-heading text-4xl font-bold leading-none tracking-tight tabular-nums text-foreground">
          {value}
        </p>
        <p className="mt-1.5 text-sm font-medium text-muted-foreground">{label}</p>
      </div>
    </CardContent>
  );

  if (!href) {
    return <Card className="shadow-sm">{body}</Card>;
  }

  return (
    // The focus ring is drawn by the card, not the link inside it: the card
    // clips its children, so a ring on the link itself would be cut off.
    <Card className="shadow-sm transition-colors hover:bg-muted/50 focus-within:ring-2 focus-within:ring-ring">
      <Link href={href} className="outline-none">
        {body}
      </Link>
    </Card>
  );
}

// -------------------------------------------------------------------
// DashboardCard - a titled panel with the brand chip in its header.
//
// The title is a real <h2> so the dashboard's sections are reachable by
// screen-reader heading navigation, which a styled <div> would not be.
// -------------------------------------------------------------------
export function DashboardCard({
  icon,
  title,
  subtitle,
  action,
  children,
}: {
  icon: LucideIcon;
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card className="shadow-sm">
      <CardHeader className="border-b">
        <div className="flex min-w-0 items-center gap-3">
          <BrandChip icon={icon} />
          <div className="min-w-0">
            <h2 className="truncate font-heading text-lg font-semibold leading-snug text-foreground">{title}</h2>
            {subtitle && <p className="truncate text-sm text-muted-foreground">{subtitle}</p>}
          </div>
        </div>
        {action && <CardAction>{action}</CardAction>}
      </CardHeader>

      <CardContent>{children}</CardContent>
    </Card>
  );
}

// -------------------------------------------------------------------
// EmptyState - what a card shows instead of a list when there is nothing in
// it. Says what would be here, so an empty card does not read as broken.
// -------------------------------------------------------------------
export function EmptyState({ icon: Icon, title, subtitle }: { icon: LucideIcon; title: string; subtitle?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-10 text-center">
      <span className="flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Icon size={22} aria-hidden="true" />
      </span>
      <p className="mt-3 text-sm font-medium text-foreground">{title}</p>
      {subtitle && <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>}
    </div>
  );
}

// A small "view everything" button for a card header.
function ViewAllButton({ href, label }: { href: string; label: string }) {
  return (
    <Button variant="outline" size="sm" asChild>
      <Link href={href}>
        {label}
        <ArrowRight size={16} aria-hidden="true" />
      </Link>
    </Button>
  );
}

// -------------------------------------------------------------------
// Teams
//
// Membership is many-to-many, so a member count is a count of team_members
// rows, not of people who "belong to" the team in any exclusive sense - the
// same person can appear in several of these.
// -------------------------------------------------------------------
export function TeamsCard({ teams, totalTeams }: { teams: DashboardTeamDTO[]; totalTeams: number }) {
  const extra = totalTeams - teams.length;

  return (
    <DashboardCard
      icon={LayoutPanelLeft}
      title="Teams"
      subtitle={totalTeams === 1 ? "1 active team" : `${totalTeams} active teams`}
      action={<ViewAllButton href={ROUTES.ADMIN_TEAMS} label="Manage" />}
    >
      {teams.length === 0 ? (
        <EmptyState icon={LayoutPanelLeft} title="No teams yet" subtitle="Create a team to group people" />
      ) : (
        <>
          <ul className="space-y-1">
            {teams.map((team) => (
              <li key={team.id} className="flex items-center gap-3 rounded-lg px-2 py-2">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <LayoutPanelLeft size={16} aria-hidden="true" />
                </span>
                <p className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{team.name}</p>
                <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                  {team.memberCount} {team.memberCount === 1 ? "member" : "members"}
                </span>
              </li>
            ))}
          </ul>

          {extra > 0 && (
            <p className="mt-3 border-t border-border pt-3 text-center text-xs text-muted-foreground">
              {extra} more {extra === 1 ? "team" : "teams"}
            </p>
          )}
        </>
      )}
    </DashboardCard>
  );
}

// -------------------------------------------------------------------
// Recent broadcasts
//
// Titles and audiences only. The stored body is rich text and is rendered
// (sanitised) on the notifications page, so none of it is put on this one.
// -------------------------------------------------------------------
export function RecentBroadcastsCard({ broadcasts }: { broadcasts: DashboardBroadcastDTO[] }) {
  return (
    <DashboardCard
      icon={Bell}
      title="Recent notifications"
      action={<ViewAllButton href={ROUTES.ADMIN_NOTIFICATIONS} label="View all" />}
    >
      {broadcasts.length === 0 ? (
        <EmptyState icon={Bell} title="Nothing sent yet" subtitle="Messages you send appear here" />
      ) : (
        <ul className="space-y-3">
          {broadcasts.map((broadcast) => (
            <li key={broadcast.id} className="flex items-start gap-3">
              <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Bell size={16} aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">{broadcast.title}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {broadcast.audienceLabel} · {formatDistanceToNow(broadcast.createdAt, { addSuffix: true })}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </DashboardCard>
  );
}
