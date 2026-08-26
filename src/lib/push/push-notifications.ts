import "server-only";

import { generateId } from "better-auth";
import webpush from "web-push";

import {
  deletePushSubscriptionByEndpointRepo,
  deletePushSubscriptionRepo,
  getPushSubscriptionsForUserRepo,
  touchPushSubscriptionRepo,
  upsertPushSubscriptionRepo,
} from "@/lib/data/repositories/push-subscriptions.repository";
import { envClient } from "@/lib/env-client";
import { envServer } from "@/lib/env-server";

// -------------------------------------------------------------------
// Web Push - the server half.
//
// A push message is encrypted end to end for one device: the browser
// vendor's service relays it without being able to read it. That is what
// the p256dh and auth values on each subscription are for, and it is why
// this uses the web-push library rather than an HTTP call - the VAPID JWT
// and the AES128GCM payload encryption are real cryptography and not
// something to hand-roll.
//
// THE FEATURE IS OPTIONAL. With no VAPID keys configured the toggle never
// renders and every send here is a no-op, so an environment without them
// behaves exactly as it did before push existed rather than erroring.
//
// A NOTIFICATION IS NOT A CHANNEL FOR CONTENT. What goes in a payload is
// delivered to a locked screen, is stored by the browser vendor in transit,
// and is visible to anyone holding the phone. So sends carry a title, a
// short line and a URL - never a transcript, never a summary, never
// anything from a meeting. The notification's job is to say something is
// ready and get the person to a page where the app can check who they are.
// -------------------------------------------------------------------

export function isPushConfigured(): boolean {
  return Boolean(envClient.NEXT_PUBLIC_VAPID_PUBLIC_KEY && envServer.VAPID_PRIVATE_KEY);
}

// Configured once, on first use. web-push keeps this as module state, and
// setting it per call would be wasted work on every send.
let configured = false;

function configure(): boolean {
  if (configured) return true;
  if (!isPushConfigured()) return false;

  webpush.setVapidDetails(
    // Identifies us to the push service so it has somebody to contact about
    // a misbehaving sender. Must be a mailto: or https: URL.
    envServer.VAPID_SUBJECT,
    envClient.NEXT_PUBLIC_VAPID_PUBLIC_KEY as string,
    envServer.VAPID_PRIVATE_KEY as string,
  );

  configured = true;

  return true;
}

// -------------------------------------------------------------------
// Register this device against the signed-in user.
//
// The user id is passed in by the action, which reads it from the session -
// never from the request body. A device cannot be registered for somebody
// else's account.
// -------------------------------------------------------------------
export async function registerBrowserPush(
  installationId: string,
  userId: string,
  keys: { endpoint: string; p256dh: string; auth: string },
): Promise<void> {
  await upsertPushSubscriptionRepo({
    id: generateId(),
    installationId,
    userId,
    endpoint: keys.endpoint,
    p256dh: keys.p256dh,
    auth: keys.auth,
    lastUsedAt: null,
  });
}

export async function unregisterBrowserPush(installationId: string): Promise<void> {
  await deletePushSubscriptionRepo(installationId);
}

export type PushMessage = {
  title: string;
  body: string;
  // Where the notification opens. A path on this app, so the page it lands
  // on does its own session check - the notification itself proves nothing.
  url: string;
  // Groups notifications on the device so a second one about the same thing
  // replaces the first rather than stacking.
  tag?: string;
};

// -------------------------------------------------------------------
// Send to every device a person has registered.
//
// Best-effort by design and it never throws. This is called from the end of
// a transcription, and a push service being briefly unavailable must not
// fail a job whose transcript is already stored - the person would lose
// work over a notification, which is exactly backwards.
//
// Returns how many devices accepted it, mostly so the caller can log
// something honest.
// -------------------------------------------------------------------
export async function sendPushToUser(userId: string, message: PushMessage): Promise<number> {
  if (!configure()) return 0;

  let delivered = 0;

  try {
    const subscriptions = await getPushSubscriptionsForUserRepo(userId);

    for (const subscription of subscriptions) {
      try {
        await webpush.sendNotification(
          {
            endpoint: subscription.endpoint,
            keys: { p256dh: subscription.p256dh, auth: subscription.auth },
          },
          JSON.stringify(message),
        );

        delivered += 1;

        // Telemetry only, and deliberately not awaited into the failure
        // path below - a failed stamp must not look like a failed send.
        await touchPushSubscriptionRepo(subscription.id).catch(() => {});
      } catch (error) {
        const statusCode = (error as { statusCode?: number }).statusCode;

        // 404 and 410 are the push service saying this endpoint is gone for
        // good - uninstalled, site data cleared, subscription revoked. That
        // is definitive, so the row goes; leaving it would repeat the same
        // failure on every send from now on.
        //
        // Anything else (a timeout, a 5xx) is transient and the row stays.
        if (statusCode === 404 || statusCode === 410) {
          await deletePushSubscriptionByEndpointRepo(subscription.endpoint);
          continue;
        }

        console.warn(`[push] could not deliver to a device for user ${userId}`, error);
      }
    }
  } catch (error) {
    console.error(`[push] send failed for user ${userId}`, error);
  }

  return delivered;
}
