"use client";

import { Controller, type Control, type FieldPath, type FieldValues } from "react-hook-form";

import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

type FormSwitchFieldProps<TFieldValues extends FieldValues> = {
  control: Control<TFieldValues>;
  name: FieldPath<TFieldValues>;
  label: string;
  /** Consequence of turning it off, when that is not obvious from the label. */
  description?: string;
};

// -------------------------------------------------------------------
// FormSwitchField
//
// The label-left / switch-right row used for boolean fields (nearly always
// "Active"). Shared so the switch is always labelled and always sits on the
// same side of the row.
// -------------------------------------------------------------------
export function FormSwitchField<TFieldValues extends FieldValues>({
  control,
  name,
  label,
  description,
}: FormSwitchFieldProps<TFieldValues>) {
  // The field name is unique within a form, and a form dialog is the only thing
  // mounted at a time, so it doubles as the control's id.
  const inputId = String(name);
  const descriptionId = description ? `${inputId}-description` : undefined;

  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => (
        <div className="flex items-center justify-between gap-4">
          <div className="grid gap-1">
            <Label htmlFor={inputId}>{label}</Label>
            {description && (
              <p id={descriptionId} className="text-xs text-muted-foreground">
                {description}
              </p>
            )}
          </div>

          <Switch
            id={inputId}
            checked={field.value ?? false}
            onCheckedChange={field.onChange}
            aria-describedby={descriptionId}
          />
        </div>
      )}
    />
  );
}
