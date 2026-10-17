"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Store } from "lucide-react";
import { CommandPaletteTrigger } from "@/components/command-palette";
import { AppRole } from "@/lib/permissions";
import { type NavFeatures, routesFor } from "@/lib/routes";
import { cn } from "@/lib/utils";

export interface AdminNavProps {
  user: { name: string; role: AppRole };
  storeName: string;
  features?: NavFeatures;
}

export function Brand({ storeName }: { storeName: string }) {
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

// Navegação do painel: usada na sidebar fixa (desktop) e na gaveta da barra superior (celular e
// tablet). Atalhos, instalação do app e o menu do usuário ficam na barra superior (AdminTopbar).
export function SidebarContent({
  user,
  storeName,
  features,
  onNavigate,
}: AdminNavProps & { onNavigate?: () => void }) {
  const pathname = usePathname();
  // Menu filtrado pela matriz de acesso (src/lib/permissions.ts) e pelos recursos da loja
  const navItems = routesFor(user.role, features);

  return (
    <div className="flex h-full flex-col gap-4 p-4">
      <div className="px-1 py-1">
        <Brand storeName={storeName} />
      </div>

      <CommandPaletteTrigger variant="sidebar" onClick={onNavigate} />

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
              prefetch={false}
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
