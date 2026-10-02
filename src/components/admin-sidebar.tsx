"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { Store, LogOut, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AppRole, ROLE_LABELS } from "@/lib/permissions";
import { routesFor } from "@/lib/routes";

interface AdminSidebarProps {
  user: { name: string; role: AppRole };
}

export function AdminSidebar({ user }: AdminSidebarProps) {
  const pathname = usePathname();
  // Menu filtrado pela matriz de acesso (src/lib/permissions.ts)
  const navItems = routesFor(user.role);

  return (
    <aside className="w-64 border-r bg-card h-screen sticky top-0 flex flex-col justify-between p-4 shrink-0">
      <div className="space-y-6">
        {/* Header / Logo */}
        <div className="flex items-center gap-3 px-2 py-1">
          <div className="p-2 bg-primary text-primary-foreground rounded-lg">
            <Store className="w-6 h-6" />
          </div>
          <div>
            <h1 className="font-bold text-base leading-tight">Gestão de Lojas</h1>
            <p className="text-xs text-muted-foreground">Painel Administrativo</p>
          </div>
        </div>

        {/* Navigation */}
        <nav className="space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive =
              pathname === item.href ||
              (item.href !== "/admin" && pathname.startsWith(item.href + "/"));

            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-primary text-primary-foreground font-semibold"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                }`}
              >
                <Icon className="w-4 h-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>

      <div className="space-y-3">
        <Link
          href="/admin/minha-conta"
          title="Minha conta"
          className={`flex items-center gap-2 rounded-lg border px-3 py-2 transition-colors hover:bg-accent ${
            pathname === "/admin/minha-conta" ? "border-primary" : ""
          }`}
        >
          <UserRound className="w-4 h-4 text-muted-foreground shrink-0" />
          <div className="min-w-0">
            <p className="text-sm font-medium truncate">{user.name}</p>
            <p className="text-xs text-muted-foreground">{ROLE_LABELS[user.role]} · Minha conta</p>
          </div>
        </Link>

        <Button
          variant="ghost"
          className="w-full justify-start text-muted-foreground hover:text-destructive hover:bg-destructive/10 gap-3"
          onClick={() => signOut({ callbackUrl: "/login" })}
        >
          <LogOut className="w-4 h-4" />
          Sair do Sistema
        </Button>

        <div className="p-3 bg-muted/50 rounded-lg text-xs text-muted-foreground">
          <p className="font-medium text-foreground">Sistema de Gestão v1.0</p>
          <p>Desenvolvimento Clean & Objetivo</p>
        </div>
      </div>
    </aside>
  );
}
