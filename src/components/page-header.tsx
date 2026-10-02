import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface PageHeaderProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  icon?: LucideIcon;
  // Botões e ações da página, alinhados à direita no desktop e abaixo do título no celular
  actions?: React.ReactNode;
  className?: string;
}

// Cabeçalho padrão das páginas do painel (título, ícone, descrição e ações)
export function PageHeader({
  title,
  description,
  icon: Icon,
  actions,
  className,
}: PageHeaderProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between",
        className,
      )}
    >
      <div className="min-w-0 space-y-1">
        <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight sm:text-2xl">
          {Icon && <Icon className="text-primary size-6 shrink-0" aria-hidden />}
          {title}
        </h1>
        {description && <p className="text-muted-foreground text-sm">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
