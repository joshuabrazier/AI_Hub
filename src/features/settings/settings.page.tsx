"use client";

import PortalPage from "@/features/layout/portal-page";

import { AppearanceSettings } from "./components/appearance-settings";

// -------------------------------------------------------------------
// Settings Page
//
// WHY THIS IS SMALL NOW. Sign-in is Microsoft only, so the three things
// that used to live here belong to Entra rather than to this app:
//
//   Password  - there isn't one. Nothing here can change it.
//   Email     - it is the Entra identity, and the value the domain
//               allowlist was checked against when the account was created.
//               Letting somebody edit it here would separate the account
//               from the directory it is trusted because of, and the
//               allowlist does not re-run on update.
//   2FA       - Entra challenges at sign-in under your tenant's Conditional
//               Access policy. An app-level TOTP enrolment would never be
//               asked for, so offering it would be a control that does
//               nothing.
//
// Name, preferred name and phone are the person's own and are edited on the
// account page, not here.
// -------------------------------------------------------------------
export function SettingsPage() {
  return (
    <PortalPage eyebrow="Account" title="Settings" description="Manage how the app looks for you.">
      <div className="w-full max-w-xl">
        <AppearanceSettings />
      </div>
    </PortalPage>
  );
}
