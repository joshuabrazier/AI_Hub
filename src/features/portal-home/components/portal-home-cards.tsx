import Link from "next/link";
import { ArrowRight, type LucideIcon, Sparkles, UserCircle } from "lucide-react";

import { Card, CardAction, CardContent, CardHeader } from "@/components/ui/card";
import { chatFeatureLabel } from "@/lib/ai/assistant-identity";
import { ROUTES } from "@/lib/routes";
import { cn } from "@/lib/utils";


// The brand chip used on card headers, matching the staff dashboard so both
// areas read as one product.
const BRAND_CHIP = "flex shrink-0 items-center justify-center rounded-2xl bg-primary text-primary-foreground";

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
// Quick links
// -------------------------------------------------------------------
const QUICK_LINKS: { label: string; description: string; href: string; icon: LucideIcon }[] = [
  {
    // Derived, so this card and the sidebar entry it duplicates cannot
    // disagree about what the feature is called. See chatFeatureLabel.
    label: chatFeatureLabel(),
    description: "Ask a question and get an answer",
    href: ROUTES.PORTAL_AI_CHAT,
    icon: Sparkles,
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
