import { Layers } from "lucide-react";

import PortalPage from "@/features/layout/portal-page";
import { Card, CardContent } from "@/components/ui/card";

import { ManagedClassCard } from "./components/managed-class-card";
import { getManagedClassesService } from "./manage-classes.service";

// -------------------------------------------------------------------
// Manager classes list
//
// Only the classes of the teams the signed-in manager holds. The service
// resolves that set from the session, so there is no filter for this page to
// get wrong - and a class with no owning team is admin-only, so it cannot
// appear in a manager's list at all.
// -------------------------------------------------------------------
export default async function ManageClassesPage() {
  const { classes, isUnrestricted } = await getManagedClassesService();

  return (
    <PortalPage
      eyebrow="Manager"
      title="Classes"
      description={
        isUnrestricted
          ? "You are an admin, so every class is shown here."
          : "The classes running for the teams you manage."
      }
    >
      {classes.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center">
            <span className="mx-auto flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <Layers size={22} aria-hidden="true" />
            </span>
            <p className="mt-3 text-sm font-medium text-foreground">No classes yet</p>
            <p className="mt-0.5 text-sm text-muted-foreground">
              An admin sets a class up against a team. Once one of your teams has one, it appears here.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {classes.map((managedClass) => (
            <ManagedClassCard key={managedClass.id} managedClass={managedClass} />
          ))}
        </div>
      )}
    </PortalPage>
  );
}
