import "server-only";

import { database, DBClient } from "@/lib/data/kysely-database-client";
import { handleError } from "@/lib/handle-errors";
import type { NewPushSubscription, PushSubscription } from "../kysely-database-types";

// -------------------------------------------------------------------
// Web Push subscriptions, one row per device.
// -------------------------------------------------------------------

// -------------------------------------------------------------------
// Record a device, or update it if it is already known.
//
// UPSERT ON installation_id, and that is the whole point of the column. A
// browser re-subscribes whenever its push endpoint rotates - which vendors
// do periodically - and without this every rotation would leave a dead row
// behind that the send path would keep trying and failing to deliver to.
//
// The user id comes with it, so a device that a second person signs in on
// is reassigned rather than left pointing at the first. The browser holds
// exactly one subscription, and it can only deliver to whoever is signed in
// now, so following that is the only honest option.
// -------------------------------------------------------------------
export async function upsertPushSubscriptionRepo(
  subscription: NewPushSubscription,
  db: DBClient = database,
): Promise<void> {
  try {
    await db
      .insertInto("pushSubscriptions")
      .values(subscription)
      .onConflict((conflict) =>
        conflict.column("installationId").doUpdateSet({
          userId: subscription.userId,
          endpoint: subscription.endpoint,
          p256dh: subscription.p256dh,
          auth: subscription.auth,
          updatedAt: new Date(),
        }),
      )
      .execute();
  } catch (error) {
    throw handleError("upsertPushSubscriptionRepo", error);
  }
}

// -------------------------------------------------------------------
// Forget a device.
//
// Keyed on installation id alone rather than on (installationId, userId).
// Turning notifications off must work even when the row belongs to somebody
// who was signed in on this device earlier - the browser subscription is
// being unsubscribed either way, so leaving the row would guarantee a dead
// endpoint.
// -------------------------------------------------------------------
export async function deletePushSubscriptionRepo(
  installationId: string,
  db: DBClient = database,
): Promise<void> {
  try {
    await db.deleteFrom("pushSubscriptions").where("installationId", "=", installationId).execute();
  } catch (error) {
    throw handleError("deletePushSubscriptionRepo", error);
  }
}

// -------------------------------------------------------------------
// Every device belonging to one person. A notification goes to all of them.
// -------------------------------------------------------------------
export async function getPushSubscriptionsForUserRepo(
  userId: string,
  db: DBClient = database,
): Promise<PushSubscription[]> {
  try {
    return await db.selectFrom("pushSubscriptions").selectAll().where("userId", "=", userId).execute();
  } catch (error) {
    throw handleError("getPushSubscriptionsForUserRepo", error);
  }
}

// -------------------------------------------------------------------
// Remove a subscription the push service has told us is dead.
//
// Vendors answer 404 or 410 for an endpoint that no longer exists - the app
// was uninstalled, site data was cleared, the subscription was revoked.
// That is a definitive answer, and the row has to go or every later send
// repeats the same failure forever.
// -------------------------------------------------------------------
export async function deletePushSubscriptionByEndpointRepo(
  endpoint: string,
  db: DBClient = database,
): Promise<void> {
  try {
    await db.deleteFrom("pushSubscriptions").where("endpoint", "=", endpoint).execute();
  } catch (error) {
    throw handleError("deletePushSubscriptionByEndpointRepo", error);
  }
}

// -------------------------------------------------------------------
// Stamp a device as having been delivered to. Best-effort telemetry, so it
// never fails a send.
// -------------------------------------------------------------------
export async function touchPushSubscriptionRepo(id: string, db: DBClient = database): Promise<void> {
  try {
    await db
      .updateTable("pushSubscriptions")
      .set({ lastUsedAt: new Date() })
      .where("id", "=", id)
      .execute();
  } catch (error) {
    throw handleError("touchPushSubscriptionRepo", error);
  }
}
