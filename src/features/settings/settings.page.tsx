"use client";

import { useState } from "react";

import PortalPage from "@/features/layout/portal-page";
import { Button } from "@/components/ui/button";
import { ChangeEmailForm } from "./components/change-email-form";
import { ChangePasswordForm } from "./components/change-password-form";
import { AppearanceSettings } from "./components/appearance-settings";
import { TwoFactorSettings } from "@/features/two-factor/two-factor-settings";

type SettingsSection = "password" | "email" | "security" | "appearance";

const SETTINGS_SECTIONS: { key: SettingsSection; label: string }[] = [
  { key: "password", label: "Password" },
  { key: "email", label: "Email" },
  { key: "security", label: "Security" },
  { key: "appearance", label: "Appearance" },
];

// -------------------------------------------------------------------
// Settings Page
// -------------------------------------------------------------------
export function SettingsPage() {
  const [activeSection, setActiveSection] = useState<SettingsSection>("password");

  return (
    <PortalPage
      eyebrow="Account"
      title="Settings"
      description="Manage your password, email, security and appearance."
    >
      <div className="flex flex-col gap-8 md:flex-row">
        {/* Section nav (left column) */}
        <nav aria-label="Settings sections" className="flex shrink-0 flex-row flex-wrap gap-1 md:w-56 md:flex-col">
          {SETTINGS_SECTIONS.map((section) => (
            <Button
              key={section.key}
              type="button"
              variant={activeSection === section.key ? "secondary" : "ghost"}
              onClick={() => setActiveSection(section.key)}
              aria-current={activeSection === section.key}
              className="justify-start md:w-full"
            >
              {section.label}
            </Button>
          ))}
        </nav>

        {/* Active section (right column) */}
        <div className="w-full max-w-xl">
          {activeSection === "password" && <ChangePasswordForm />}
          {activeSection === "email" && <ChangeEmailForm />}
          {activeSection === "security" && <TwoFactorSettings />}
          {activeSection === "appearance" && <AppearanceSettings />}
        </div>
      </div>
    </PortalPage>
  );
}
