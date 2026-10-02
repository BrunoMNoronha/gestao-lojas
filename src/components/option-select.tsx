"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

export interface SelectOption {
  value: string;
  label: React.ReactNode;
  disabled?: boolean;
}

interface OptionSelectProps {
  value: string;
  onValueChange: (value: string) => void;
  options: SelectOption[];
  // id aplicado ao gatilho, para associar a um <Label htmlFor>
  id?: string;
  name?: string;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  className?: string;
  "aria-label"?: string;
  "aria-invalid"?: boolean;
}

// Select de lista simples (valor → rótulo) sobre o ui/select, no lugar do select nativo do HTML
export function OptionSelect({
  value,
  onValueChange,
  options,
  id,
  name,
  placeholder,
  disabled,
  required,
  className,
  ...aria
}: OptionSelectProps) {
  // Sem opção "" na lista, valor vazio significa "nada selecionado" (exibe o placeholder)
  const hasEmptyOption = options.some((option) => option.value === "");

  return (
    <Select
      value={value === "" && !hasEmptyOption ? null : value}
      onValueChange={(v) => onValueChange(v ?? "")}
      items={options.map(({ value, label }) => ({ value, label }))}
      name={name}
      disabled={disabled}
      required={required}
    >
      <SelectTrigger id={id} className={cn("w-full", className)} {...aria}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
