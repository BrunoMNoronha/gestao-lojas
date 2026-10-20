import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

// Molduras decorativas das capturas. Só a imagem dentro delas é conteúdo; o resto é aria-hidden.

export function BrowserFrame({
  children,
  label = "Gestão de Lojas",
  className,
}: {
  children: ReactNode;
  label?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "bg-card ring-foreground/10 overflow-hidden rounded-xl shadow-2xl ring-1 shadow-black/10 dark:shadow-black/40",
        className,
      )}
    >
      <div
        aria-hidden="true"
        className="bg-muted/70 flex items-center gap-2 border-b px-3 py-2 sm:px-4 sm:py-2.5"
      >
        <span className="flex gap-1.5">
          <span className="size-2.5 rounded-full bg-[oklch(0.7_0.17_25)]" />
          <span className="size-2.5 rounded-full bg-[oklch(0.8_0.14_80)]" />
          <span className="size-2.5 rounded-full bg-[oklch(0.72_0.15_150)]" />
        </span>
        <span className="bg-background text-muted-foreground mx-auto hidden max-w-xs flex-1 truncate rounded-md px-3 py-0.5 text-center text-xs sm:block">
          {label}
        </span>
        <span className="hidden w-11 sm:block" />
      </div>
      {children}
    </div>
  );
}

export function PhoneFrame({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "bg-foreground/90 dark:bg-muted rounded-[2rem] p-1.5 shadow-2xl ring-1 shadow-black/20 ring-black/10 dark:ring-white/10",
        className,
      )}
    >
      <div className="bg-background overflow-hidden rounded-[1.6rem]">{children}</div>
    </div>
  );
}
