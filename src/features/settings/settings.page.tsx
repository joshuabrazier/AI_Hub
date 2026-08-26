"use client";

import PortalPage from "@/features/layout/portal-page";
import { PushNotificationToggle } from "@/features/push/components/push-notification-toggle";

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
//
// NOTIFICATIONS ARE PER DEVICE, not per account, which is worth knowing
// when reading the toggle below: turning them on here turns them on for
// THIS browser, and somebody with a laptop and a phone has to do it on
// both. It renders nothing at all when push is unconfigured, unsupported,
// or on an iPhone that has not been added to the Home Screen yet, so it
// never shows a control that cannot work.
// -------------------------------------------------------------------
export function SettingsPage() {
  return (
    <PortalPage eyebrow="Account" title="Settings" description="Manage how the app looks and how it notifies you on this device.">
      <div className="flex w-full max-w-xl flex-col gap-4">
        <AppearanceSettings />
        <PushNotificationToggle />
      </div>
    </PortalPage>
  );
}
