import { SITE_CONTENT_KEYS, type SiteContentKey } from "@/lib/data/kysely-database-types";
import { BRAND } from "@/lib/brand";

import { DEFAULT_CONTACT_DETAILS } from "./contact-content";
import type { LandingCta, LandingFeatures, LandingHero, LandingHighlights } from "./landing-content.types";

// -------------------------------------------------------------------
// Default page content
//
// Used when a key has no row yet or its stored value is empty, and to pre-fill
// the admin editor. Once an admin saves, the stored value takes over.
//
// There is no seed file, so on a fresh database THESE ARE THE SHIPPED SITE.
// They have to read as real copy for a real product rather than placeholder
// text: a new project should be able to deploy this, look deliberate, and then
// edit its way to something specific.
// -------------------------------------------------------------------

export const DEFAULT_LANDING_HERO: LandingHero = {
  eyebrow: "Portal",
  heading: "Everything your people need, in one place",
  subheading:
    "A secure portal for your teams: the schedule, the documents, and the messages that keep everyone moving in the same direction.",
  primaryCta: { label: "Get in touch", href: "/contact" },
  secondaryCta: { label: "Sign in", href: "/sign-in" },
  // Points at a file this base actually ships, so a fresh clone renders a
  // complete home page rather than a gap. Replace public/hero.png, change this
  // path from Admin -> Home page, or blank it out - with no image the hero text
  // widens to fill the row, which is a deliberate layout rather than a hole.
  imageUrl: "/hero.png",
  // Decorative: the heading beside it already says what the page is about, so
  // a screen reader gains nothing from a description of an abstract image.
  imageAlt: "",
};

export const DEFAULT_LANDING_HIGHLIGHTS: LandingHighlights = [
  {
    icon: "shield",
    title: "Secure by default",
    body: "Two-factor authentication, role-based access and a full audit trail, switched on from day one.",
  },
  {
    icon: "users",
    title: "Organised by team",
    body: "Group people the way your work is actually structured, and give each team its own manager.",
  },
  {
    icon: "ruler",
    title: "Measured, not guessed",
    body: "Attendance, activity and history recorded as they happen, so the numbers hold up later.",
  },
  {
    icon: "workflow",
    title: "Built to adapt",
    body: "Programs, classes and sessions you can shape around your process rather than ours.",
  },
];

export const DEFAULT_LANDING_FEATURES: LandingFeatures = {
  heading: "What you can run from here",
  intro: "One place for the work, the people doing it, and the record of both.",
  items: [
    {
      icon: "graduation",
      title: "Programs and classes",
      description: "Define what you offer, then schedule it with its own dates, capacity and location.",
    },
    {
      icon: "table",
      title: "Scheduling and attendance",
      description: "A weekly view for staff, a personal one for members, and attendance captured against both.",
    },
    {
      icon: "messages",
      title: "Notifications",
      description: "Message everyone, a team, a class or one person, with each person's preferences respected.",
    },
    {
      icon: "check",
      title: "Documents and consent",
      description: "Publish documents to sign, and see at a glance who has signed which version.",
    },
    {
      icon: "lock",
      title: "Access control",
      description: "Admins, team managers and members each see exactly their own scope, enforced server-side.",
    },
    {
      icon: "activity",
      title: "Audit and retention",
      description: "An append-only record of privileged actions, with a retention policy you control.",
    },
  ],
};

export const DEFAULT_LANDING_CTA: LandingCta = {
  heading: "Ready to take a look?",
  body: "Tell us what you are trying to run, and we will show you how it maps onto the portal.",
  cta: { label: "Start a conversation", href: "/contact" },
};

// -------------------------------------------------------------------
// The full default set, keyed the same way as the site_content table.
//
//  - about / privacy / terms / media consent: rich-text HTML
//  - contact and the landing_* blocks: JSON strings
// -------------------------------------------------------------------
export const SITE_CONTENT_DEFAULTS: Record<SiteContentKey, string> = {
  [SITE_CONTENT_KEYS.ABOUT]: `<p>${BRAND.legalName} builds and runs secure portals for organisations that need their people, their schedule and their records in one place.</p><p>This page is editable from the admin area. Replace it with your own story: who you are, what you do, and why someone should trust you with their data.</p>`,

  [SITE_CONTENT_KEYS.CONTACT]: JSON.stringify(DEFAULT_CONTACT_DETAILS),

  [SITE_CONTENT_KEYS.PRIVACY_POLICY]: `<p>This Privacy Policy explains how ${BRAND.legalName} collects, uses and protects your personal information when you use this website and the portal.</p><h2>Information we collect</h2><p>We collect the information you give us directly, such as your name, contact details and anything you submit through a form. We also collect limited technical information automatically, such as your browser type and the pages you view.</p><h2>How we use your information</h2><p>We use your information to provide the service, respond to enquiries, communicate important updates, and improve what we offer. We do not sell your personal information.</p><h2>How we protect it</h2><p>Access is restricted by role, sensitive fields are encrypted at rest, and privileged actions are recorded in an audit trail. We take reasonable technical and organisational steps to protect information from misuse, loss and unauthorised access.</p><h2>How long we keep it</h2><p>We keep personal information only as long as we need it. Inactive records are de-identified in line with our retention policy.</p><h2>Your choices</h2><p>You may request access to, or correction of, the information we hold about you at any time. You can also change your notification preferences from your account.</p><h2>Contact us</h2><p>If you have any questions about this policy, please get in touch through our Contact page.</p>`,

  [SITE_CONTENT_KEYS.TERMS_AND_CONDITIONS]: `<p>These Terms and Conditions govern your use of this website and the portal provided by ${BRAND.legalName}. Please read them carefully.</p><h2>Your account</h2><p>Accounts are created by invitation. You are responsible for keeping your sign-in details secure and for activity carried out under your account. Tell us promptly if you believe your account has been compromised.</p><h2>Acceptable use</h2><p>Use the service only for its intended purpose. Do not attempt to reach data belonging to others, disrupt the service, or work around its access controls.</p><h2>Availability</h2><p>We aim to keep the service available and accurate, but we do not guarantee uninterrupted access. We may change or suspend features where we need to, and will give reasonable notice where that is practical.</p><h2>Your information</h2><p>How we handle personal information is described in our Privacy Policy, which forms part of these terms.</p><h2>Liability</h2><p>To the extent permitted by law, ${BRAND.legalName} is not liable for loss arising from your use of the service except where caused by our negligence.</p><h2>Changes to these terms</h2><p>We may update these terms from time to time. The current version is always available on this page.</p>`,

  [SITE_CONTENT_KEYS.MEDIA_CONSENT]: `<p>This consent covers photographs, video and audio recorded during activities run through this portal, and how that material may be used.</p><h2>How material may be used</h2><p>Material may be used on our website, our social media channels, and in printed or digital material about the service. We will not sell it to third parties, and we will not identify you by full name without asking you separately.</p><h2>Your choices</h2><p>Giving this consent is optional and is not a condition of taking part. You may withdraw it at any time by contacting us, after which we will stop using the material going forward. We may be unable to recall anything already printed or published.</p><h2>Acknowledgement</h2><p>By signing, you confirm that you have read and understood this consent, and that you are authorised to give it.</p>`,

  [SITE_CONTENT_KEYS.LANDING_HERO]: JSON.stringify(DEFAULT_LANDING_HERO),
  [SITE_CONTENT_KEYS.LANDING_HIGHLIGHTS]: JSON.stringify(DEFAULT_LANDING_HIGHLIGHTS),
  [SITE_CONTENT_KEYS.LANDING_FEATURES]: JSON.stringify(DEFAULT_LANDING_FEATURES),
  [SITE_CONTENT_KEYS.LANDING_CTA]: JSON.stringify(DEFAULT_LANDING_CTA),
};
