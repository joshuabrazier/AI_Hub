"use client";

import { Controller, type Control, type FieldPath, type FieldValues } from "react-hook-form";

import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type FormTextareaFieldProps<TFieldValues extends FieldValues> = {
  control: Control<TFieldValues>;
  name: FieldPath<TFieldValues>;
  label: string;
  description?: string;
  disabled?: boolean;
} & Omit<React.ComponentProps<typeof Textarea>, "name" | "value" | "defaultValue" | "onChange" | "onBlur" | "ref">;

export function FormTextareaField<TFieldValues extends FieldValues>({
  control,
  name,
  label,
  description,
  disabled,
  id,
  ...textareaProps
}: FormTextareaFieldProps<TFieldValues>) {
  const inputId = id ?? String(name);

  const descriptionId = description ? `${inputId}-description` : undefined;
  const errorId = `${inputId}-error`;

  const ariaDescribedBy = [descriptionId, textareaProps["aria-describedby"], errorId].filter(Boolean).join(" ");

  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <div className="grid gap-2">
          <Label htmlFor={inputId}>{label}</Label>

          <Textarea
            {...textareaProps}
            {...field}
            id={inputId}
            disabled={disabled}
            aria-invalid={fieldState.invalid}
            aria-describedby={ariaDescribedBy || undefined}
          />

          {description && (
            <p id={descriptionId} className="text-sm text-muted-foreground">
              {description}
            </p>
          )}

          {fieldState.error && (
            <p id={errorId} role="alert" className="text-sm text-destructive">
              {fieldState.error.message}
            </p>
          )}
        </div>
      )}
    />
  );
}
