import {
  Activity,
  BarChart3,
  Building2,
  CheckCircle2,
  Compass,
  Database,
  GaugeCircle,
  GraduationCap,
  LineChart,
  type LucideIcon,
  Lock,
  MessagesSquare,
  Ruler,
  Search,
  Shield,
  Sparkles,
  Table2,
  Target,
  Users,
  Workflow,
  Zap,
} from "lucide-react";
import { z } from "zod";

// -------------------------------------------------------------------
// Landing page content
//
// The public home page is assembled from admin-editable blocks stored in
// site_content, so changing the headline, the highlights or the feature cards
// does not need a code change or a deploy.
//
// Each block is stored as a JSON string. That means the value in the database
// is only as trustworthy as the last thing written to it, so every block is
// parsed through a Zod schema on READ. A malformed value falls back to the
// coded default rather than throwing - a bad row must never take the public
// site down - and the admin editor validates before saving so nobody can store
// something the page will silently ignore.
// -------------------------------------------------------------------

// -------------------------------------------------------------------
// Icons
//
// Icons are stored as NAMES, and a name is only ever resolved through this
// map. Resolving an arbitrary string against the lucide module would pull the
// entire icon set into the bundle, and would let whatever is in the database
// decide which component renders. A closed map keeps both problems out.
//
// To offer more choices, add to this map - that is the only place to edit.
// -------------------------------------------------------------------
export const LANDING_ICONS = {
  activity: Activity,
  barChart: BarChart3,
  building: Building2,
  check: CheckCircle2,
  compass: Compass,
  database: Database,
  gauge: GaugeCircle,
  graduation: GraduationCap,
  lineChart: LineChart,
  lock: Lock,
  messages: MessagesSquare,
  ruler: Ruler,
  search: Search,
  shield: Shield,
  sparkles: Sparkles,
  table: Table2,
  target: Target,
  users: Users,
  workflow: Workflow,
  zap: Zap,
} as const satisfies Record<string, LucideIcon>;

export type LandingIconName = keyof typeof LANDING_ICONS;

export const LANDING_ICON_NAMES = Object.keys(LANDING_ICONS) as [LandingIconName, ...LandingIconName[]];

/** Resolve a stored icon name. Falls back rather than rendering nothing. */
export function landingIcon(name: string): LucideIcon {
  return LANDING_ICONS[name as LandingIconName] ?? LANDING_ICONS.sparkles;
}

// -------------------------------------------------------------------
// Block schemas
//
// Links are constrained to same-site paths or explicit mailto/tel. Storing a
// free-form URL would make the home page an open redirect that any admin could
// set, and it is not a capability the page needs.
// -------------------------------------------------------------------
const internalHref = z
  .string()
  .trim()
  .min(1, "Link is required")
  .max(200)
  .refine(
    (value) => value.startsWith("/") || value.startsWith("mailto:") || value.startsWith("tel:"),
    "Link must be a path starting with /, or a mailto: or tel: link",
  );

const callToAction = z.object({
  label: z.string().trim().min(1, "Label is required").max(60),
  href: internalHref,
});

export const landingHeroSchema = z.object({
  eyebrow: z.string().trim().max(60).default(""),
  heading: z.string().trim().min(1, "Heading is required").max(120),
  subheading: z.string().trim().max(300).default(""),
  primaryCta: callToAction,
  secondaryCta: callToAction.optional(),
});

export const landingHighlightSchema = z.object({
  icon: z.enum(LANDING_ICON_NAMES),
  title: z.string().trim().min(1, "Title is required").max(80),
  body: z.string().trim().max(240).default(""),
});

export const landingHighlightsSchema = z.array(landingHighlightSchema).max(6);

export const landingFeatureSchema = z.object({
  icon: z.enum(LANDING_ICON_NAMES),
  title: z.string().trim().min(1, "Title is required").max(80),
  description: z.string().trim().max(300).default(""),
});

export const landingFeaturesSchema = z.object({
  heading: z.string().trim().min(1, "Heading is required").max(120),
  intro: z.string().trim().max(300).default(""),
  items: z.array(landingFeatureSchema).max(9),
});

export const landingCtaSchema = z.object({
  heading: z.string().trim().min(1, "Heading is required").max(120),
  body: z.string().trim().max(300).default(""),
  cta: callToAction,
});

export type LandingHero = z.infer<typeof landingHeroSchema>;
export type LandingHighlight = z.infer<typeof landingHighlightSchema>;
export type LandingHighlights = z.infer<typeof landingHighlightsSchema>;
export type LandingFeatures = z.infer<typeof landingFeaturesSchema>;
export type LandingCta = z.infer<typeof landingCtaSchema>;

export type LandingContent = {
  hero: LandingHero;
  highlights: LandingHighlights;
  features: LandingFeatures;
  cta: LandingCta;
};

// -------------------------------------------------------------------
// Parse a stored JSON block, falling back to the supplied default.
//
// Returns the default on malformed JSON OR on a shape mismatch, so a bad row
// degrades to the shipped copy instead of breaking the page. The caller gets
// `usedFallback` so the admin editor can say the stored value was ignored,
// rather than leaving someone to wonder why their edit did nothing.
// -------------------------------------------------------------------
export function parseLandingBlock<T>(
  schema: z.ZodType<T>,
  rawValue: string,
  fallback: T,
): { value: T; usedFallback: boolean } {
  if (!rawValue.trim()) return { value: fallback, usedFallback: false };

  try {
    const parsed = schema.safeParse(JSON.parse(rawValue));
    return parsed.success ? { value: parsed.data, usedFallback: false } : { value: fallback, usedFallback: true };
  } catch {
    return { value: fallback, usedFallback: true };
  }
}
