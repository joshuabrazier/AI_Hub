"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";

import { envClient } from "@/lib/env-client";

// The push state of THIS device/browser:
// - loading:      not detected yet (initial, avoids a flash)
// - unsupported:  push not available here (no VAPID key, or no SW/Push/Notification)
// - needs-install: iOS, but the app isn't added to the Home Screen yet
// - default:      supported and not switched on (can be turned on)
// - granted:      switched on and subscribed on this device
// - denied:       blocked in the browser/OS settings
export type PushStatus = "loading" | "unsupported" | "needs-install" | "default" | "granted" | "denied";

type PushStatusContextValue = {
  status: PushStatus;
  // Re-read the current state. Call after enabling/disabling so anything driven
  // off the status (the account toggle, the sidebar nudge dot) updates at once.
  refresh: () => void;
};

const PushStatusContext = createContext<PushStatusContextValue>({ status: "loading", refresh: () => {} });

export function usePushStatus(): PushStatusContextValue {
  return useContext(PushStatusContext);
}

// True when push is available on this device but NOT switched on - i.e. the
// account toggle would show a "turn on"/blocked/needs-install state. Used to
// nudge the user (a red dot on My Account) toward turning notifications on.
export function isPushNudge(status: PushStatus): boolean {
  return status === "default" || status === "denied" || status === "needs-install";
}

// Detect the real state on this device. When permission is granted we still
// confirm an active subscription exists, so turning push OFF (which unsubscribes
// but leaves the browser permission granted) correctly reads back as "default".
async function detectPushStatus(): Promise<PushStatus> {
  if (!envClient.NEXT_PUBLIC_VAPID_PUBLIC_KEY) return "unsupported";

  const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  if (!supported) return "unsupported";

  // iOS Safari only supports Web Push once the app is installed (standalone).
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as unknown as { standalone?: boolean }).standalone === true;
  if (isIos && !standalone) return "needs-install";

  if (Notification.permission !== "granted") return Notification.permission as PushStatus;

  try {
    const registration = await navigator.serviceWorker.getRegistration();
    const subscription = await registration?.pushManager.getSubscription();
    return subscription ? "granted" : "default";
  } catch {
    return "default";
  }
}

// -------------------------------------------------------------------
// Holds this device's push state for the authenticated shell, so the sidebar
// can show a nudge dot and the account toggle can share one source of truth.
// Detection is client-only; it starts "loading" to avoid an SSR/hydration flash.
// -------------------------------------------------------------------
export function PushStatusProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<PushStatus>("loading");

  const refresh = useCallback(() => {
    let active = true;
    void detectPushStatus().then((next) => {
      if (active) setStatus(next);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return <PushStatusContext.Provider value={{ status, refresh }}>{children}</PushStatusContext.Provider>;
}
