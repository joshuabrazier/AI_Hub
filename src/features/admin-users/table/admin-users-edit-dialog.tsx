"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";

import { handleFrontendErrorWithToast } from "@/lib/handle-errors";

import { FormDialog } from "@/components/form/form-dialog";
import { FormSelectField } from "@/components/form/form-select-field";
import { FormSwitchField } from "@/components/form/form-switch-field";
import { useFormDialogSubmit } from "@/components/form/use-form-dialog-submit";
import { Button } from "@/components/ui/button";
import { MESSAGES } from "@/lib/constants";
import { USER_ROLE_OPTIONS } from "@/lib/data/kysely-database-types";

import { resetUserTwoFactorAction, updateAdminUserAction } from "../admin-users.actions";
import {
  ADMIN_USER_DISPLAY_STATUS,
  AdminUserResponseDTO,
  UpdateAdminUserRequestDTO,
  UpdateAdminUserSchema,
} from "../admin-users.types";

type AdminUsersEditDialogProps = {
  user: AdminUserResponseDTO | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

type FormValues = UpdateAdminUserRequestDTO;

// -------------------------------------------------------------------
// Edit a person's platform role and active status.
//
// ONLY THE PLATFORM ROLE. There is nothing else about an account an admin
// changes from here - this dialog used to show the person's teams read-only
// beside it, and teams are gone from the base.
// -------------------------------------------------------------------
export function AdminUsersEditDialog({ user, open, onOpenChange }: AdminUsersEditDialogProps) {
  const userIsActive = user?.displayStatus === ADMIN_USER_DISPLAY_STATUS.Active;

  const form = useForm<FormValues>({
    resolver: zodResolver(UpdateAdminUserSchema),
    defaultValues: {
      id: user?.id ?? "",
      userRole: user?.userRole,
      isActive: userIsActive,
    },
  });

  const { userRole, isActive } = useWatch({ control: form.control });

  useEffect(() => {
    if (!user) return;

    form.reset({
      id: user.id,
      userRole: user.userRole,
      isActive: user.displayStatus === ADMIN_USER_DISPLAY_STATUS.Active,
    });
  }, [user, open, form]);

  const { isPending, submit } = useFormDialogSubmit<FormValues>({ form, onOpenChange });

  if (!user) return null;

  // Nothing to save until the role or the active flag actually differs from
  // what the person already has.
  const isChanged = userRole !== user.userRole || isActive !== userIsActive;

  const onSubmit = (values: FormValues) => submit(values, () => updateAdminUserAction(values), MESSAGES.USER_UPDATED);

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      onDismiss={() => form.reset()}
      title="Edit person"
      description="Update their role and whether they can sign in"
      onSubmit={form.handleSubmit(onSubmit)}
      submitLabel="Save changes"
      canSubmit={isChanged}
      isPending={isPending}
      beforeForm={
        // Who is being edited.
        <div className="rounded-md border bg-muted p-3">
          <div className="pb-2 font-medium">{user.name}</div>
          <div className="text-sm text-muted-foreground">{user.email}</div>
        </div>
      }
    >
      <FormSelectField control={form.control} name="userRole" label="Role" options={USER_ROLE_OPTIONS} />

      {/* Deactivating also signs the person out everywhere - see the service,
          which deletes their sessions. */}
      <FormSwitchField
        control={form.control}
        name="isActive"
        label="Active"
        description="Turning this off signs them out immediately."
      />

      {/* Only when there is something to reset. An always-visible destructive
          button on an account with no second factor invites a pointless
          click and a confusing error. */}
      {user.hasTwoFactor ? <TwoFactorResetSection user={user} /> : null}
    </FormDialog>
  );
}

// -------------------------------------------------------------------
// Clear a person's second factor.
//
// Outside the form on purpose. It is not a field being saved with the
// others - it takes effect on its own, immediately, and pairing it with
// "Save changes" would make an admin choose between two unrelated edits.
//
// Two clicks rather than a confirm dialog: this dialog is already a modal,
// and stacking another on top of it is worse than an inline confirm.
// -------------------------------------------------------------------
function TwoFactorResetSection({ user }: { user: AdminUserResponseDTO }) {
  const [isConfirming, setIsConfirming] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const [isDone, setIsDone] = useState(false);
  const router = useRouter();

  const onReset = async () => {
    if (isPending) return;
    setIsPending(true);

    try {
      const response = await resetUserTwoFactorAction({ id: user.id });

      if (!response.success) {
        toast.error(response.formError ?? "Could not reset two-factor authentication");
        return;
      }

      setIsDone(true);
      toast.success(`${user.name} can now set up two-factor authentication again`);
      // The row's badge is server-rendered, so it needs a refresh to stop
      // offering a reset for a factor that is already gone.
      router.refresh();
    } catch (error) {
      handleFrontendErrorWithToast(error);
    } finally {
      setIsPending(false);
      setIsConfirming(false);
    }
  };

  if (isDone) {
    return (
      <div className="rounded-md border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
        Two-factor authentication has been reset. {user.name} will be asked to set it up again the
        next time they open the app.
      </div>
    );
  }

  return (
    <div className="rounded-md border border-border p-3">
      <div className="text-sm font-medium text-foreground">Two-factor authentication</div>
      <p className="mt-1 text-sm text-muted-foreground">
        {isConfirming
          ? "This removes their current authenticator and backup codes. They will set it up again next time they open the app, and any device still signed in will be asked to as well."
          : "Reset this if they have lost their phone, deleted their authenticator app, or run out of backup codes."}
      </p>

      <div className="mt-3 flex gap-2">
        {isConfirming ? (
          <>
            <Button type="button" variant="destructive" onClick={onReset} disabled={isPending}>
              {isPending ? "Resetting..." : "Yes, reset it"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setIsConfirming(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
          </>
        ) : (
          <Button type="button" variant="outline" onClick={() => setIsConfirming(true)}>
            Reset two-factor
          </Button>
        )}
      </div>
    </div>
  );
}
