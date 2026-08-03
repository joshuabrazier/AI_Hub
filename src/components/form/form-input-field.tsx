"use client";

import { Controller, type Control, type FieldPath, type FieldValues } from "react-hook-form";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type FormInputFieldProps<TFieldValues extends FieldValues> = {
  control: Control<TFieldValues>;
  name: FieldPath<TFieldValues>;
  label: string;
  description?: string;
  disabled?: boolean;
  transformValue?: (e: React.ChangeEvent<HTMLInputElement>) => unknown;
} & Omit<React.ComponentProps<typeof Input>, "name" | "value" | "defaultValue" | "onChange" | "onBlur" | "ref">;

export function FormInputField<TFieldValues extends FieldValues>({
  control,
  name,
  label,
  description,
  disabled,
  transformValue,
  id,
  ...inputProps
}: FormInputFieldProps<TFieldValues>) {
  const inputId = id ?? String(name);

  const descriptionId = description ? `${inputId}-description` : undefined;
  const errorId = `${inputId}-error`;

  const ariaDescribedBy = [descriptionId, inputProps["aria-describedby"], errorId].filter(Boolean).join(" ");

  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <div className="grid gap-2">
          <Label htmlFor={inputId}>{label}</Label>

          <Input
            {...inputProps}
            {...field}
            id={inputId}
            disabled={disabled}
            {...field}
            value={field.value ?? ""}
            onChange={(e) => {
              field.onChange(transformValue ? transformValue(e) : e.target.value);
            }}
            aria-invalid={fieldState.invalid}
            aria-describedby={ariaDescribedBy || undefined}
          />

          {description && (
            <p id={descriptionId} className="text-muted-foreground text-sm">
              {description}
            </p>
          )}

          {fieldState.error && (
            <p id={errorId} role="alert" className="text-destructive text-sm">
              {fieldState.error.message}
            </p>
          )}
        </div>
      )}
    />
  );
}
