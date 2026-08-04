import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { ArrowRight, Bell, Files, LayoutPanelLeft, type LucideIcon, UserCircle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader } from "@/components/ui/card";
import { TEAM_ROLE_LABELS } from "@/lib/data/kysely-database-types";
import { ROUTES } from "@/lib/routes";
import { cn } from "@/lib/utils";

import type { PortalNotificationDTO, PortalTeamDTO } from "../portal-home.types";

// The brand chip used on card headers, matching the staff dashboard so both
// areas read as one product.
const BRAND_CHIP = "flex shrink-0 items-center justify-center rounded-2xl bg-primary text-primary-foreground";

// -------------------------------------------------------------------
// Shared bits
// -------------------------------------------------------------------
function EmptyState({ icon: Icon, title, subtitle }: { icon: LucideIcon; title: string; subtitle?: string }) {
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

// Titled card header with a small icon chip. The title is a real <h2> so the
// page's sections are reachable by screen-reader heading navigation.
function CardHeaderRow({
  icon: Icon,
  title,
  subtitle,
  action,
}: {
  icon: LucideIcon;
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <CardHeader className="border-b">
      <div className="flex min-w-0 items-center gap-3">
        <span className={cn(BRAND_CHIP, "size-9")}>
          <Icon size={18} aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h2 className="truncate font-heading text-lg font-semibold leading-snug text-foreground">{title}</h2>
          {subtitle && <p className="truncate text-sm text-muted-foreground">{subtitle}</p>}
        </div>
      </div>
      {action && <CardAction>{action}</CardAction>}
    </CardHeader>
  );
}

// -------------------------------------------------------------------
// Your teams
//
// Membership is many-to-many, so this is always a list - a member can be in
// none, one, or several teams. A retired team is still shown, flagged, because
// the member is still in it.
// -------------------------------------------------------------------
export function YourTeamsCard({ teams }: { teams: PortalTeamDTO[] }) {
  return (
    <Card className="shadow-sm">
      <CardHeaderRow icon={LayoutPanelLeft} title="Your teams" />

      <CardContent>
        {teams.length === 0 ? (
          <EmptyState
            icon={LayoutPanelLeft}
            title="No teams yet"
            subtitle="You are not in a team at the moment"
          />
        ) : (
          <ul className="space-y-2">
            {teams.map((team) => (
              <li key={team.teamId} className="flex items-center gap-3 rounded-lg px-2 py-2">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <LayoutPanelLeft size={16} aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">{team.teamName}</p>
                  <p className="truncate text-xs text-muted-foreground">{TEAM_ROLE_LABELS[team.teamRole]}</p>
                </div>
                {!team.isActive && <Badge variant="secondary">Retired</Badge>}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

// -------------------------------------------------------------------
// Recent notifications
//
// Titles only. The stored body is rich text and is rendered on the
// notifications page, which sanitises it; nothing here needs it.
// -------------------------------------------------------------------
export function RecentNotificationsCard({
  notifications,
  unreadCount,
}: {
  notifications: PortalNotificationDTO[];
  unreadCount: number;
}) {
  return (
    <Card className="shadow-sm">
      <CardHeaderRow
        icon={Bell}
        title="Notifications"
        subtitle={unreadCount > 0 ? `${unreadCount} unread` : "All caught up"}
        action={
          <Button variant="outline" size="sm" asChild>
            <Link href={ROUTES.PORTAL_NOTIFICATIONS}>View all</Link>
          </Button>
        }
      />

      <CardContent>
        {notifications.length === 0 ? (
          <EmptyState icon={Bell} title="Nothing yet" subtitle="Messages for you appear here" />
        ) : (
          <ul className="space-y-3">
            {notifications.map((notification) => (
              <li key={notification.id} className="flex items-start gap-3">
                <span
                  className={cn(
                    "mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full",
                    notification.isUnread
                      ? "bg-primary text-primary-foreground"
                      : "bg-primary/10 text-primary",
                  )}
                >
                  <Bell size={16} aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <p
                    className={cn(
                      "truncate text-sm text-foreground",
                      notification.isUnread ? "font-semibold" : "font-medium",
                    )}
                  >
                    {notification.title}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {formatDistanceToNow(notification.createdAt, { addSuffix: true })}
                  </p>
                </div>
                {notification.isUnread && (
                  <Badge variant="success" className="shrink-0">
                    New
                  </Badge>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

// -------------------------------------------------------------------
// Quick links
// -------------------------------------------------------------------
const QUICK_LINKS: { label: string; description: string; href: string; icon: LucideIcon }[] = [
  {
    label: "Notifications",
    description: "Messages waiting for you",
    href: ROUTES.PORTAL_NOTIFICATIONS,
    icon: Bell,
  },
  {
    label: "Documents",
    description: "Read and sign what is outstanding",
    href: ROUTES.PORTAL_DOCUMENTS,
    icon: Files,
  },
  {
    label: "Account",
    description: "Your details and preferences",
    href: ROUTES.PORTAL_ACCOUNT,
    icon: UserCircle,
  },
];

export function QuickLinksCard() {
  return (
    <Card className="shadow-sm">
      <CardHeaderRow icon={ArrowRight} title="Quick links" />

      <CardContent>
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {QUICK_LINKS.map((link) => {
            const Icon = link.icon;

            return (
              <li key={link.href}>
                <Link
                  href={link.href}
                  className="flex items-center gap-3 rounded-lg px-3 py-3 transition-colors hover:bg-muted"
                >
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <Icon size={16} aria-hidden="true" />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-foreground">{link.label}</span>
                    <span className="block truncate text-xs text-muted-foreground">{link.description}</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
