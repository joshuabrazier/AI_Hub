import PortalPage from "@/features/layout/portal-page";

import { NotificationInbox } from "./components/notification-inbox";
import { getMyNotificationsService } from "./notifications.service";

// -------------------------------------------------------------------
// PortalNotificationsPage
//
// The signed-in member's inbox. The service reads it by session user id, so
// the route needs no id and there is nothing here to point at somebody else.
// -------------------------------------------------------------------
export default async function PortalNotificationsPage() {
  const { notifications, unreadCount } = await getMyNotificationsService();

  return (
    <PortalPage
      eyebrow="Your portal"
      title="Notifications"
      description="Messages sent to you. Opening one marks it as read."
    >
      <NotificationInbox notifications={notifications} unreadCount={unreadCount} />
    </PortalPage>
  );
}
