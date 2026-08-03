"use client";

import { Controller, type Control, type FieldPath, type FieldValues } from "react-hook-form";

import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type SelectOption<TValue extends string = string> = {
  value: TValue;
  label: string;
};

type FormSelectFieldProps<TFieldValues extends FieldValues, TValue extends string = string> = {
  control: Control<TFieldValues>;
  name: FieldPath<TFieldValues>;
  label: string;
  options: readonly SelectOption<TValue>[];
  placeholder?: string;
  description?: string;
  disabled?: boolean;
  id?: string;
  className?: string;
};

export function FormSelectField<TFieldValues extends FieldValues, TValue extends string = string>({
  control,
  name,
  label,
  options,
  placeholder = "Select an option",
  description,
  disabled,
  id,
  className,
}: FormSelectFieldProps<TFieldValues, TValue>) {
  const inputId = id ?? String(name);

  const descriptionId = description ? `${inputId}-description` : undefined;
  const errorId = `${inputId}-error`;

  const ariaDescribedBy = [descriptionId, errorId].filter(Boolean).join(" ");

  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <div className="grid gap-2">
          <Label htmlFor={inputId}>{label}</Label>

          <Select
            value={field.value ? String(field.value) : ""}
            onValueChange={field.onChange}
            onOpenChange={(open) => {
              if (!open) {
                field.onBlur();
              }
            }}
            disabled={disabled}
          >
            <SelectTrigger
              id={inputId}
              className={`w-full ${className ?? ""}`}
              aria-invalid={fieldState.invalid}
              aria-describedby={ariaDescribedBy || undefined}
            >
              <SelectValue placeholder={placeholder} />
            </SelectTrigger>

            <SelectContent>
              {options.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {description && (
            <p id={descriptionId} className="text-sm text-muted-foreground">
              {description}
            </p>
          )}

          {fieldState.error && (
            <p id={errorId} className="text-sm text-destructive">
              {fieldState.error.message}
            </p>
          )}
        </div>
      )}
    />
  );
}
