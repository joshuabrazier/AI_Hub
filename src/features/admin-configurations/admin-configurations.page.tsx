import { getAllEnquiryCategoriesAction } from "@/features/admin-enquiry-categories/admin-enquiry-categories.actions";
import { AdminEnquiryCategoriesTable } from "@/features/admin-enquiry-categories/table/admin-enquiry-categories-table";
import { getAllNotificationTypesAction } from "@/features/admin-notification-types/admin-notification-types.actions";
import { AdminNotificationTypesTable } from "@/features/admin-notification-types/table/admin-notification-types-table";
import PortalPage from "@/features/layout/portal-page";

// -------------------------------------------------------------------
// Admin Configurations page
//
// One place for the admin-managed lookup lists that feed dropdowns elsewhere.
// Each section is fetched independently so one failing to load leaves the
// others usable rather than blanking the page.
//
// Only lists that are genuinely data belong here. Anything driven by an enum
// in the schema (roles, statuses) is not editable and must not appear.
// -------------------------------------------------------------------
export default async function AdminConfigurationsPage() {
  const [enquiryCategories, notificationTypes] = await Promise.all([
    getAllEnquiryCategoriesAction(),
    getAllNotificationTypesAction(),
  ]);

  return (
    <PortalPage
      eyebrow="Admin"
      title="Configurations"
      description="Manage the option lists that appear in dropdowns across the app."
    >
      <div className="space-y-10">
        <section className="space-y-3">
          <div>
            <h2 className="font-heading text-lg font-bold text-foreground">Enquiry categories</h2>
            <p className="text-sm text-muted-foreground">
              The options in the &quot;What is your enquiry about?&quot; dropdown on the public enquiry form. Set the
              display order, and hide a category with the Active switch rather than deleting it.
            </p>
          </div>
          {enquiryCategories.success ? (
            <AdminEnquiryCategoriesTable enquiryCategories={enquiryCategories.data} />
          ) : (
            <p className="text-sm text-destructive">
              {enquiryCategories.formError ?? "Couldn't load enquiry categories."}
            </p>
          )}
        </section>

        <section className="space-y-3">
          <div>
            <h2 className="font-heading text-lg font-bold text-foreground">Notification types</h2>
            <p className="text-sm text-muted-foreground">
              The categories shown when sending a notification or saving a template, and the ones people can opt out
              of by email. Deactivate a type to hide it from the pickers without affecting notifications already sent.
            </p>
          </div>
          {notificationTypes.success ? (
            <AdminNotificationTypesTable notificationTypes={notificationTypes.data} />
          ) : (
            <p className="text-sm text-destructive">
              {notificationTypes.formError ?? "Couldn't load notification types."}
            </p>
          )}
        </section>
      </div>
    </PortalPage>
  );
}
