"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  ShoppingCart,
  Package,
  Boxes,
  Users,
  Settings,
  Store,
} from "lucide-react";

const navItems = [
  { label: "Dashboard", href: "/admin", icon: LayoutDashboard },
  { label: "Frente de Caixa (PDV)", href: "/admin/pdv", icon: ShoppingCart },
  { label: "Produtos", href: "/admin/produtos", icon: Package },
  { label: "Estoque", href: "/admin/estoque", icon: Boxes },
  { label: "Clientes", href: "/admin/clientes", icon: Users },
  { label: "Configurações da Loja", href: "/admin/configuracoes", icon: Settings },
];

export function AdminSidebar() {
  const pathname = usePathname();

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
            const isActive = pathname === item.href || pathname.startsWith(item.href + "/");

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

      <div className="p-3 bg-muted/50 rounded-lg text-xs text-muted-foreground">
        <p className="font-medium text-foreground">Sistema de Gestão v1.0</p>
        <p>Desenvolvimento Clean & Objetivo</p>
      </div>
    </aside>
  );
}
