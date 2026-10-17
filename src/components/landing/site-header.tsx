import Link from "next/link";
import { ArrowRight, Menu, Store } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { NAV_LINKS } from "./content";

export function Brand({ className }: { className?: string }) {
  return (
    <span className={cn("flex items-center gap-2.5", className)}>
      <span
        aria-hidden="true"
        className="bg-primary text-primary-foreground flex size-9 items-center justify-center rounded-xl"
      >
        <Store className="size-5" />
      </span>
      <span className="text-base font-semibold tracking-tight">Gestão de Lojas</span>
    </span>
  );
}

/** Entrar (visitante) ou Ir para o painel (sessão ativa): /inicio leva à página do perfil. */
export function PrimaryCta({
  loggedIn,
  className,
  size = "lg",
}: {
  loggedIn: boolean;
  className?: string;
  size?: "lg" | "xl";
}) {
  return (
    <Link
      href={loggedIn ? "/inicio" : "/login"}
      className={cn(
        buttonVariants({ size: "lg" }),
        size === "xl" && "h-11 gap-2 px-5 text-base",
        className,
      )}
    >
      {loggedIn ? "Ir para o painel" : "Entrar"}
      <ArrowRight aria-hidden="true" />
    </Link>
  );
}

export function SiteHeader({ loggedIn }: { loggedIn: boolean }) {
  return (
    <header className="bg-background/80 supports-[backdrop-filter]:bg-background/70 sticky top-0 z-40 border-b backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-4 sm:px-6">
        <Link
          href="/"
          aria-label="Gestão de Lojas, início"
          className="focus-visible:ring-ring/50 rounded-lg outline-none focus-visible:ring-3"
        >
          <Brand />
        </Link>

        <nav aria-label="Seções da página" className="ml-auto hidden md:block">
          <ul className="flex items-center gap-1">
            {NAV_LINKS.map((link) => (
              <li key={link.href}>
                <a
                  href={link.href}
                  className="text-muted-foreground hover:text-foreground hover:bg-muted focus-visible:ring-ring/50 rounded-md px-3 py-2 text-sm font-medium transition-colors outline-none focus-visible:ring-3"
                >
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="ml-auto flex items-center gap-1 md:ml-2">
          <ThemeToggle />
          <PrimaryCta loggedIn={loggedIn} className="ml-1" />
          {/* Celular: âncoras num <details>, sem JavaScript */}
          <details className="group relative md:hidden">
            <summary
              className={cn(
                buttonVariants({ variant: "ghost", size: "icon" }),
                "list-none [&::-webkit-details-marker]:hidden",
              )}
            >
              <Menu aria-hidden="true" />
              <span className="sr-only">Seções da página</span>
            </summary>
            <nav
              aria-label="Seções da página"
              className="bg-popover text-popover-foreground ring-foreground/10 absolute right-0 mt-2 w-56 rounded-xl p-2 shadow-lg ring-1"
            >
              <ul>
                {NAV_LINKS.map((link) => (
                  <li key={link.href}>
                    <a
                      href={link.href}
                      className="hover:bg-muted focus-visible:ring-ring/50 block rounded-md px-3 py-2.5 text-sm font-medium outline-none focus-visible:ring-3"
                    >
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          </details>
        </div>
      </div>
    </header>
  );
}
