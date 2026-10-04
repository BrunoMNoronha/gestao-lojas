"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogOut, Menu, Store, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { ThemeToggle } from "@/components/theme-toggle";
import { InstallAppButton } from "@/components/install-app-button";
import { AppRole, ROLE_LABELS } from "@/lib/permissions";
import { type NavFeatures, routesFor } from "@/lib/routes";
import { cn } from "@/lib/utils";
import { signOutClearingOfflineData } from "@/lib/offline/sign-out";

interface AdminNavProps {
  user: { name: string; role: AppRole };
  storeName: string;
  features?: NavFeatures;
}

function Brand({ storeName }: { storeName: string }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <div className="bg-primary text-primary-foreground shrink-0 rounded-lg p-2">
        <Store className="size-5" />
      </div>
      <div className="min-w-0">
        <p className="truncate text-sm leading-tight font-semibold">{storeName}</p>
        <p className="text-muted-foreground text-xs">Painel administrativo</p>
      </div>
    </div>
  );
}

// Conteúdo comum da navegação: usado na sidebar fixa (desktop) e no drawer (celular/tablet)
function SidebarContent({
  user,
  storeName,
  features,
  onNavigate,
}: AdminNavProps & { onNavigate?: () => void }) {
  const pathname = usePathname();
  // Menu filtrado pela matriz de acesso (src/lib/permissions.ts) e pelos recursos da loja
  const navItems = routesFor(user.role, features);
  const accountActive = pathname === "/admin/minha-conta";

  return (
    <div className="flex h-full flex-col gap-4 p-4">
      <div className="px-1 py-1">
        <Brand storeName={storeName} />
      </div>

      <nav aria-label="Menu principal" className="-mx-1 flex-1 space-y-1 overflow-y-auto px-1">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive =
            pathname === item.href ||
            (item.href !== "/admin" && pathname.startsWith(item.href + "/"));

          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "bg-sidebar-primary text-sidebar-primary-foreground"
                  : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
              )}
            >
              <Icon className="size-4 shrink-0" />
              <span className="truncate">{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="space-y-2 border-t pt-4">
        <InstallAppButton variant="menu" />
        <div className="flex items-center gap-1">
          <Link
            href="/admin/minha-conta"
            onClick={onNavigate}
            aria-current={accountActive ? "page" : undefined}
            className={cn(
              "hover:bg-sidebar-accent flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 transition-colors",
              accountActive && "bg-sidebar-accent",
            )}
          >
            <span className="bg-muted text-muted-foreground flex size-8 shrink-0 items-center justify-center rounded-full">
              <UserRound className="size-4" />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium">{user.name}</span>
              <span className="text-muted-foreground block text-xs">
                {ROLE_LABELS[user.role]} · Minha conta
              </span>
            </span>
          </Link>
          <ThemeToggle />
        </div>

        <Button
          variant="ghost"
          className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 w-full justify-start gap-3"
          onClick={() => signOutClearingOfflineData()}
        >
          <LogOut />
          Sair do sistema
        </Button>
      </div>
    </div>
  );
}

// Sidebar fixa, visível a partir de lg
export function AdminSidebar(props: AdminNavProps) {
  return (
    <aside className="bg-sidebar text-sidebar-foreground sticky top-0 hidden h-screen w-64 shrink-0 border-r lg:block">
      <SidebarContent {...props} />
    </aside>
  );
}

// Cabeçalho com menu em drawer, visível abaixo de lg
export function AdminMobileHeader(props: AdminNavProps) {
  const [open, setOpen] = useState(false);

  return (
    <header className="bg-background/95 supports-backdrop-filter:bg-background/80 sticky top-0 z-40 flex h-14 items-center gap-2 border-b px-3 backdrop-blur lg:hidden">
      <Sheet open={open} onOpenChange={setOpen}>
        <Button variant="ghost" size="icon" aria-label="Abrir menu" onClick={() => setOpen(true)}>
          <Menu />
        </Button>
        <SheetContent side="left" className="bg-sidebar text-sidebar-foreground w-72 gap-0 p-0">
          <SheetTitle className="sr-only">Menu</SheetTitle>
          <SheetDescription className="sr-only">
            Navegação do painel administrativo
          </SheetDescription>
          <SidebarContent {...props} onNavigate={() => setOpen(false)} />
        </SheetContent>
      </Sheet>
      <Brand storeName={props.storeName} />
    </header>
  );
}
