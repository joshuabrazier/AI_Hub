"use client";

import { useState } from "react";
import { Bell, BellOff, BellRing } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { envClient } from "@/lib/env-client";
import { handleFrontendErrorWithToast } from "@/lib/handle-errors";
import { cn } from "@/lib/utils";

import { disablePushAction, enablePushAction } from "../push.actions";
import { isPushNudge, usePushStatus } from "../push-status-context";

const INSTALLATION_ID_KEY = "push-installation-id";

// VAPID public keys are base64url; the Push API wants an ArrayBuffer-backed
// Uint8Array (the explicit <ArrayBuffer> keeps TS's typed-array generics happy).
function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
}

// A stable id for this browser/device, so the server can update or remove its
// registration later.
function getInstallationId(): string {
  let id = localStorage.getItem(INSTALLATION_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(INSTALLATION_ID_KEY, id);
  }
  return id;
}

// -------------------------------------------------------------------
// PushNotificationToggle
// Lets a signed-in user turn push notifications on/off for THIS device. Renders
// nothing when push isn't configured/supported, or (on iPhone) until the app is
// installed to the Home Screen - matching how PWA push actually works. Shares
// its state via PushStatusProvider so the sidebar nudge dot stays in sync.
// -------------------------------------------------------------------
export function PushNotificationToggle() {
  const vapidKey = envClient.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const { status, refresh } = usePushStatus();
  const [busy, setBusy] = useState(false);

  // Hidden entirely when unconfigured/unsupported so it never shows a dead control.
  if (!vapidKey || status === "loading" || status === "unsupported") return null;

  // Draw attention (red) whenever push is available but not on for this device -
  // the same condition as the nav nudge dot - so it is clear the box wants action.
  const needsAttention = isPushNudge(status);

  const enable = () => {
    if (busy || !vapidKey) return;
    setBusy(true);
    void (async () => {
      try {
        const permission = await Notification.requestPermission();
        if (permission !== "granted") {
          toast.error("Notifications weren't allowed.");
          return;
        }

        const registration = await navigator.serviceWorker.register("/sw.js");
        await navigator.serviceWorker.ready;

        const subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidKey),
        });
        const keys = subscription.toJSON().keys ?? {};

        const response = await enablePushAction({
          installationId: getInstallationId(),
          endpoint: subscription.endpoint,
          p256dh: keys.p256dh ?? "",
          auth: keys.auth ?? "",
        });
        if (!response.success) {
          toast.error(response.formError ?? "Couldn't turn on notifications. Please try again.");
          return;
        }

        toast.success("Notifications are on for this device.");
      } catch (error) {
        handleFrontendErrorWithToast(error);
      } finally {
        setBusy(false);
        // Re-read the real state (subscribed / permission) so the toggle and the
        // sidebar dot both reflect the outcome.
        refresh();
      }
    })();
  };

  const disable = () => {
    if (busy) return;
    setBusy(true);
    void (async () => {
      try {
        const registration = await navigator.serviceWorker.getRegistration();
        const subscription = await registration?.pushManager.getSubscription();
        await subscription?.unsubscribe();
        await disablePushAction({ installationId: getInstallationId() });
        toast.success("Notifications are off for this device.");
      } catch (error) {
        handleFrontendErrorWithToast(error);
      } finally {
        setBusy(false);
        refresh();
      }
    })();
  };

  return (
    <div
      className={cn(
        "rounded-xl border p-4 transition-colors",
        needsAttention ? "border-red-300 bg-red-50 dark:border-red-900/50 dark:bg-red-950/30" : "border-border",
      )}
    >
      <div className="flex flex-col gap-3 min-[480px]:flex-row min-[480px]:items-start min-[480px]:justify-between">
        <div className="flex items-start gap-3">
          <span
            className={cn(
              "mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full",
              needsAttention
                ? "bg-red-100 text-red-600 dark:bg-red-950 dark:text-red-300"
                : "bg-primary/10 text-primary",
            )}
          >
            <Bell size={18} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="font-medium text-foreground">Notifications on this device</p>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {status === "needs-install"
                ? "Add this app to your Home Screen first, then you can turn on notifications here."
                : status === "denied"
                  ? "Notifications are blocked. Allow them in your browser or phone settings, then reload."
                  : status === "granted"
                    ? "You'll get a notification on this device when a transcription is ready."
                    : "Notifications are off on this device. Turn them on to be told when a transcription is ready."}
            </p>
          </div>
        </div>

        {status === "granted" ? (
          <Button type="button" variant="outline" size="sm" className="self-start shrink-0" disabled={busy} onClick={disable}>
            <BellOff size={15} aria-hidden="true" />
            Turn off
          </Button>
        ) : status === "default" ? (
          <Button type="button" size="sm" className="self-start shrink-0" loading={busy} disabled={busy} onClick={enable}>
            <BellRing size={15} aria-hidden="true" />
            Turn on
          </Button>
        ) : null}
      </div>
    </div>
  );
}
