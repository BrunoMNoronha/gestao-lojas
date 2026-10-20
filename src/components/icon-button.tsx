"use client";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

type IconButtonProps = React.ComponentProps<typeof Button> & {
  // Nome acessível (aria-label) e texto do tooltip
  label: string;
};

// Botão só com ícone: sempre com nome acessível e tooltip
export function IconButton({
  label,
  size = "icon-sm",
  variant = "ghost",
  children,
  ...props
}: IconButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={<Button size={size} variant={variant} aria-label={label} {...props} />}
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
