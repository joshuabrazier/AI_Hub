"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { FieldValues, Path, UseFormReset, UseFormSetError } from "react-hook-form";

import { handleFrontendErrorWithToast } from "@/lib/handle-errors";
import type { ServerApiResponse } from "@/lib/types";

type UseFormDialogSubmitOptions<TValues extends FieldValues> = {
  /**
   * The dialog's form. Only `setError` and `reset` are read off it, so the
   * form's own generics stay put. It is the whole form rather than a lone
   * setter because the success path has to clear it - see `submit`.
   */
  form: { setError: UseFormSetError<TValues>; reset: UseFormReset<TValues> };
  onOpenChange: (open: boolean) => void;
  /** Extra clean-up on success, before the dialog closes (e.g. local state). */
  onSuccess?: () => void;
};

// -------------------------------------------------------------------
// Map a failed action's fieldErrors onto the form.
//
// Only a name the form actually renders can show an error. Setting one on a
// name it does not know leaves the form invalid with nothing on screen saying
// why - the save button simply stops working - so anything the form cannot
// display is surfaced as a toast instead of disappearing.
// -------------------------------------------------------------------
function applyFieldErrors<TValues extends FieldValues>(
  values: TValues,
  fieldErrors: Record<string, string[]> | undefined,
  setError: UseFormSetError<TValues>,
) {
  if (!fieldErrors) return;

  Object.entries(fieldErrors).forEach(([field, errors]) => {
    const message = errors[0];
    if (!message) return;

    if (field in values) setError(field as Path<TValues>, { type: "server", message });
    else toast.error(message);
  });
}

// -------------------------------------------------------------------
// useFormDialogSubmit
//
// The submit half of every create/edit dialog: run the action, turn a failed
// ServerApiResponse into field errors and toasts, and on success toast, clear
// the form, refresh and close. The dialog keeps its own useForm so it can pick
// its validation mode, and keeps its own JSX; only this plumbing is shared.
// -------------------------------------------------------------------
export function useFormDialogSubmit<TValues extends FieldValues>({
  form,
  onOpenChange,
  onSuccess,
}: UseFormDialogSubmitOptions<TValues>) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  /**
   * `run` performs the action (a dialog that fires more than one just calls
   * this once per branch). `success` is the toast, or a function of the
   * response data when the message quotes it.
   */
  const submit = <TData,>(
    values: TValues,
    run: () => Promise<ServerApiResponse<TData>>,
    success: string | ((data: TData) => string),
  ) => {
    startTransition(async () => {
      try {
        const response = await run();

        if (!response.success) {
          applyFieldErrors(values, response.fieldErrors, form.setError);
          if (response.formError) toast.error(response.formError);
          return;
        }

        toast.success(typeof success === "function" ? success(response.data) : success);

        // Clear the form back to its defaults before closing. Closing from here
        // goes straight to onOpenChange, so it never reaches FormDialog's
        // onDismiss, and the create instance is not remounted between opens -
        // without this reset, reopening "Add" still shows what was just saved.
        form.reset();
        onSuccess?.();
        router.refresh();
        onOpenChange(false);
      } catch (error) {
        handleFrontendErrorWithToast(error);
      }
    });
  };

  return { isPending, submit };
}
