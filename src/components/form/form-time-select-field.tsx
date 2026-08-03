"use client";

import { Controller, type Control, type FieldPath, type FieldValues } from "react-hook-form";

import { Label } from "@/components/ui/label";
import { TimeSelect } from "@/components/ui/time-select";

type FormTimeSelectFieldProps<TFieldValues extends FieldValues> = {
  control: Control<TFieldValues>;
  name: FieldPath<TFieldValues>;
  label: string;
  disabled?: boolean;
  id?: string;
  className?: string;
};

// RHF-connected TimeSelect - the styled replacement for `<input type="time">`.
export function FormTimeSelectField<TFieldValues extends FieldValues>({
  control,
  name,
  label,
  disabled,
  id,
  className,
}: FormTimeSelectFieldProps<TFieldValues>) {
  const inputId = id ?? String(name);

  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <div className="grid gap-2">
          <Label htmlFor={inputId}>{label}</Label>

          <TimeSelect
            value={field.value ? String(field.value) : ""}
            onChange={field.onChange}
            disabled={disabled}
            invalid={fieldState.invalid}
            className={className}
            aria-label={label}
          />

          {fieldState.error && <p className="text-sm text-destructive">{fieldState.error.message}</p>}
        </div>
      )}
    />
  );
}
