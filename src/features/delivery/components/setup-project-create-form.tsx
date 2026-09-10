"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import z from "zod";

import { FormInputField } from "@/components/form/form-input-field";
import { FormSwitchField } from "@/components/form/form-switch-field";
import { FormTextareaField } from "@/components/form/form-textarea-field";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { MESSAGES } from "@/lib/constants";
import { handleFrontendErrorWithToast } from "@/lib/handle-errors";
import { ROUTES } from "@/lib/routes";

import { createProjectAction } from "../delivery-setup.actions";
import {
  DESCRIPTION_MAX_CHARS,
  PROJECT_TITLE_MAX_CHARS,
  type ClientOptionDTO,
  type ProjectClientRequestDTO,
} from "../delivery.types";
import { SetupClientPicker } from "./setup-client-picker";

// -------------------------------------------------------------------
// CREATE A PROJECT.
//
// Four decisions and no more: the client, a title, an optional description,
// and whether the work is billable. CreateProjectSchema carries exactly
// those, and it deliberately carries no status (a new project is active, and
// offering the choice invites somebody to create an archived one) and no
// members, phases or budget groups - those are the next screen, which this
// form navigates to with the id it gets back.
//
// THE CLIENT IS HELD BESIDE THE FORM RATHER THAN INSIDE IT, and that is not
// laziness about validation. Its value is ProjectClientSchema's discriminated
// union - the committed contract, so what this posts cannot drift from what
// the action parses - and "nothing chosen yet" is a third state that union
// deliberately has no member for. Putting a nullable union through the
// resolver makes the form's value type and the resolver's disagree, and buys
// nothing: the union is either complete or absent, which is one `if`.
// Everything about picking versus typing lives in SetupClientPicker.
// -------------------------------------------------------------------
const ProjectFormSchema = z.object({
  title: z.string().trim().min(1, "A project needs a title").max(PROJECT_TITLE_MAX_CHARS),
  description: z.string().trim().max(DESCRIPTION_MAX_CHARS),
  isBillable: z.boolean(),
});

type ProjectFormValues = z.infer<typeof ProjectFormSchema>;

const CLIENT_FIELD_ID = "project-client";
const CLIENT_DESCRIPTION_ID = "project-client-description";

export function SetupProjectCreateForm({ clients }: { clients: ClientOptionDTO[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // Null until somebody picks or types one, which is the state the union
  // has no member for. The refusal below is this form's own, because there
  // is nothing to post until it is answered.
  const [client, setClient] = useState<ProjectClientRequestDTO | null>(null);
  const [clientError, setClientError] = useState<string | null>(null);

  const form = useForm<ProjectFormValues>({
    resolver: zodResolver(ProjectFormSchema),
    mode: "onChange",
    defaultValues: {
      title: "",
      description: "",
      // Billable is the ordinary case, and the switch says what turning it
      // off means.
      isBillable: true,
    },
  });

  const onSubmit = (values: ProjectFormValues) =>
    startTransition(async () => {
      if (client === null) {
        setClientError("Choose a client, or type a new name");
        return;
      }

      try {
        const response = await createProjectAction({
          client,
          title: values.title,
          // An empty box means NULL rather than '', which is what
          // optionalText does to it at the boundary anyway.
          description: values.description.length > 0 ? values.description : null,
          isBillable: values.isBillable,
        });

        if (!response.success) {
          // A retired client holding a typed name, a client deleted between
          // the read and the save: both arrive here as a sentence somebody
          // can act on, so it is shown rather than replaced by a generic
          // failure.
          toast.error(response.formError ?? MESSAGES.SOMETHING_WENT_WRONG);
          return;
        }

        toast.success("Project created. Now add its people, budget and phases.");

        // Straight into setup, because a project with no members is
        // invisible to everybody except an admin until membership is set.
        router.push(ROUTES.adminProjectSetup(response.data));
      } catch (error) {
        handleFrontendErrorWithToast(error);
      }
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle>New project</CardTitle>
        <CardDescription>
          A project starts with nobody on it. The next screen is where its members, budget groups and phases are
          set up, and it opens as soon as this is saved.
        </CardDescription>
      </CardHeader>

      <CardContent>
        <form onSubmit={form.handleSubmit(onSubmit)} className="max-w-2xl space-y-6">
          <div className="grid gap-2">
            <Label htmlFor={CLIENT_FIELD_ID}>Client</Label>

            <SetupClientPicker
              id={CLIENT_FIELD_ID}
              clients={clients}
              value={client}
              onChange={(next) => {
                setClient(next);
                setClientError(null);
              }}
              invalid={clientError !== null}
              describedBy={CLIENT_DESCRIPTION_ID}
              disabled={isPending}
            />

            <p id={CLIENT_DESCRIPTION_ID} className="text-sm text-muted-foreground">
              Retired clients are not offered. The client cannot be changed afterwards: moving a project would
              re-attribute every hour already logged against it.
            </p>

            {clientError && (
              <p role="alert" className="text-sm text-destructive">
                {clientError}
              </p>
            )}
          </div>

          <FormInputField
            control={form.control}
            name="title"
            label="Project title"
            maxLength={PROJECT_TITLE_MAX_CHARS}
            placeholder="e.g. Website rebuild"
            disabled={isPending}
          />

          <FormTextareaField
            control={form.control}
            name="description"
            label="Description"
            maxLength={DESCRIPTION_MAX_CHARS}
            placeholder="What the project is for. Optional."
            disabled={isPending}
          />

          <FormSwitchField
            control={form.control}
            name="isBillable"
            label="Billable"
            description="Turn this off for internal work. The time is still logged and still costs; there is simply nothing to charge for it, so the project's chargeable value stays unknown rather than nought."
          />

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => router.push(ROUTES.ADMIN_PROJECTS)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isPending || !form.formState.isValid} loading={isPending}>
              {isPending ? "Creating…" : "Create project"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
