import PortalPage from "@/features/layout/portal-page";

import { NotificationComposerDialog } from "./components/notification-composer-dialog";
import { ManageTemplatesDialog } from "./components/manage-templates-dialog";
import { SentNotificationsView } from "./components/sent-notifications-view";
import { getStaffNotificationsService } from "./notifications.service";

// -------------------------------------------------------------------
// StaffNotificationsPage
//
// One page for both staff areas. /admin/notifications and
// /manage/notifications render the same component and call the same service;
// the difference between them is the scope that service resolves from the
// session, not a different screen.
//
// Building a separate manager copy is how two screens end up with two answers
// to "who may this person message", and only one of them gets fixed.
// -------------------------------------------------------------------
export default async function StaffNotificationsPage({ eyebrow }: { eyebrow: string }) {
  const { sent, audience, templates, notificationTypes, isUnrestricted } =
    await getStaffNotificationsService();

  return (
    <PortalPage
      eyebrow={eyebrow}
      title="Notifications"
      description={
        isUnrestricted
          ? "Message members, and see what has already gone out."
          : "Message the teams you manage, and see what you have already sent."
      }
      actions={
        <div className="flex flex-wrap gap-2">
          <NotificationComposerDialog
            audience={audience}
            notificationTypes={notificationTypes}
            triggerLabel="New notification"
            dialogTitle="New notification"
            dialogDescription="Write a message and choose who it goes to."
          />
          <NotificationComposerDialog
            audience={audience}
            notificationTypes={notificationTypes}
            templates={templates}
            triggerLabel="From template"
            triggerVariant="outline"
            dialogTitle="Notification from template"
            dialogDescription="Start from a saved template, choose who it goes to, and send."
          />
          {/* Templates are platform-wide content with no team behind them, so
              only an admin edits them. Managers still send from them above. */}
          {isUnrestricted && (
            <ManageTemplatesDialog templates={templates} notificationTypes={notificationTypes} />
          )}
        </div>
      }
    >
      <SentNotificationsView sent={sent} />
    </PortalPage>
  );
}
