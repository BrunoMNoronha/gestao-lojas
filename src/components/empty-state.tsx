import { DatabaseZap, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface EmptyStateProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  icon?: LucideIcon;
  // Tom do ícone: neutro (lista vazia), primário (ação esperada) ou destrutivo (erro/bloqueio)
  tone?: "muted" | "primary" | "destructive";
  action?: React.ReactNode;
  // Ocupa a área útil da página, centralizado (estados de página inteira)
  fullPage?: boolean;
  // Título como h1 quando o estado substitui a página inteira (sem PageHeader acima)
  headingLevel?: "h1" | "h2";
  className?: string;
}

const toneClasses = {
  muted: "bg-muted text-muted-foreground",
  primary: "bg-primary/10 text-primary",
  destructive: "bg-destructive/10 text-destructive",
} as const;

// Estado vazio, bloqueado ou indisponível com ícone, mensagem e ação opcional
export function EmptyState({
  title,
  description,
  icon: Icon,
  tone = "muted",
  action,
  fullPage,
  headingLevel = "h2",
  className,
}: EmptyStateProps) {
  const Heading = headingLevel;
  const content = (
    <div
      className={cn(
        "bg-card mx-auto flex max-w-md flex-col items-center rounded-xl border p-6 text-center",
        className,
      )}
    >
      {Icon && (
        <div className={cn("mb-3 rounded-full p-3", toneClasses[tone])}>
          <Icon className="size-6" aria-hidden />
        </div>
      )}
      <Heading className="text-lg font-semibold">{title}</Heading>
      {description && <p className="text-muted-foreground mt-2 text-sm">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );

  if (!fullPage) return content;
  return <div className="flex min-h-[60vh] items-center justify-center">{content}</div>;
}

interface UnavailableStateProps {
  title: React.ReactNode;
  description?: React.ReactNode;
}

// Falha ao carregar dados do banco: mensagem padrão das páginas do painel
export function UnavailableState({ title, description }: UnavailableStateProps) {
  return (
    <EmptyState
      fullPage
      headingLevel="h1"
      icon={DatabaseZap}
      tone="destructive"
      title={title}
      description={
        description ??
        "Não foi possível carregar os dados. Verifique a conexão com o banco de dados e recarregue a página."
      }
    />
  );
}
