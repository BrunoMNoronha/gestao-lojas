"use client";

import * as React from "react";
import { Input } from "@/components/ui/input";
import { formatMoneyInput, parseMoneyInput } from "@/lib/masks";
import { cn } from "@/lib/utils";

type MoneyInputProps = Omit<
  React.ComponentProps<"input">,
  "type" | "value" | "defaultValue" | "onChange" | "inputMode"
> & {
  /** Valor em reais; null deixa o campo vazio (mostra o placeholder). */
  value: number | null;
  onValueChange: (value: number | null) => void;
};

/**
 * Campo de dinheiro com máscara R$ 1.234,56: cada dígito entra pelos centavos (da direita para a
 * esquerda), sem depender de vírgula. Abre o teclado numérico no celular.
 */
export function MoneyInput({
  value,
  onValueChange,
  placeholder = "R$ 0,00",
  className,
  onFocus,
  onMouseUp,
  ...props
}: MoneyInputProps) {
  const justFocused = React.useRef(false);

  // A digitação é pelos centavos: o cursor fica no fim do texto
  const moveCaretToEnd = (input: HTMLInputElement) => {
    requestAnimationFrame(() => {
      const end = input.value.length;
      input.setSelectionRange(end, end);
    });
  };

  return (
    <Input
      {...props}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      placeholder={placeholder}
      value={formatMoneyInput(value)}
      onChange={(e) => {
        const next = parseMoneyInput(e.target.value);
        if (next !== undefined) onValueChange(next);
        moveCaretToEnd(e.target);
      }}
      onFocus={(e) => {
        // Ao entrar no campo, seleciona o valor: digitar substitui (ex.: o total já preenchido no
        // valor recebido do PDV) em vez de acrescentar dígitos ao fim
        const input = e.target;
        justFocused.current = true;
        requestAnimationFrame(() => input.select());
        onFocus?.(e);
      }}
      onMouseUp={(e) => {
        // O clique que deu foco reposicionaria o cursor no mouseup, desfazendo a seleção
        if (justFocused.current) e.preventDefault();
        justFocused.current = false;
        onMouseUp?.(e);
      }}
      className={cn("tabular-nums", className)}
    />
  );
}
