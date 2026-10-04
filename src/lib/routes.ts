import {
  BarChart3,
  Boxes,
  HandCoins,
  LayoutDashboard,
  Package,
  Settings,
  ShoppingCart,
  Truck,
  UserCog,
  UserRound,
  Users,
  Wallet,
  WifiOff,
  type LucideIcon,
} from "lucide-react";
import { type AppRole, type Permission, can, homePathFor } from "@/lib/permissions";

// Mapa central das rotas do painel: o menu lateral e a checagem de acesso das páginas leem daqui.
export interface AppRoute {
  href: string;
  label: string;
  icon: LucideIcon;
  permission: Permission;
  // Fora do menu lateral (ex.: "Minha conta", acessada pelo bloco do usuário)
  hidden?: boolean;
  // Item que some do menu quando o recurso da loja está inativo (só visual: a página continua
  // protegida pela permissão)
  feature?: NavFeature;
}

// "onAccount": Contas a Receber, oculto com o fiado desligado e sem títulos a receber (issue #29)
export type NavFeature = "onAccount";

/** Recursos visíveis no menu; ausente ou true = exibido. */
export type NavFeatures = Partial<Record<NavFeature, boolean>>;

export const APP_ROUTES: AppRoute[] = [
  { href: "/admin", label: "Dashboard", icon: LayoutDashboard, permission: "dashboard.view" },
  { href: "/admin/pdv", label: "Frente de Caixa (PDV)", icon: ShoppingCart, permission: "pdv.use" },
  // PDV que abre sem internet depois da preparação (issue #37); fica fora do layout do /admin
  { href: "/pdv", label: "PDV sem internet", icon: WifiOff, permission: "pdv.use" },
  { href: "/admin/caixa", label: "Caixa", icon: Wallet, permission: "cash.own" },
  {
    href: "/admin/contas-a-receber",
    label: "Contas a Receber",
    icon: HandCoins,
    permission: "receivables.view",
    feature: "onAccount",
  },
  {
    href: "/admin/relatorios/vendas",
    label: "Relatórios",
    icon: BarChart3,
    permission: "reports.view",
  },
  { href: "/admin/produtos", label: "Produtos", icon: Package, permission: "catalog.view" },
  { href: "/admin/estoque", label: "Estoque", icon: Boxes, permission: "stock.view" },
  { href: "/admin/clientes", label: "Clientes", icon: Users, permission: "customers.view" },
  {
    href: "/admin/fornecedores",
    label: "Fornecedores",
    icon: Truck,
    permission: "suppliers.manage",
  },
  {
    href: "/admin/configuracoes",
    label: "Configurações da Loja",
    icon: Settings,
    permission: "settings.manage",
  },
  { href: "/admin/usuarios", label: "Usuários", icon: UserCog, permission: "users.manage" },
  {
    href: "/admin/minha-conta",
    label: "Minha conta",
    icon: UserRound,
    permission: "account.self",
    hidden: true,
  },
];

export function routesFor(
  role: AppRole | null | undefined,
  features: NavFeatures = {},
): AppRoute[] {
  return APP_ROUTES.filter(
    (route) =>
      !route.hidden &&
      can(role, route.permission) &&
      (!route.feature || features[route.feature] !== false),
  );
}

/**
 * Converte um destino pós-login em caminho interno seguro. Aceita caminho relativo ("/admin/x")
 * ou URL absoluta da mesma origem; qualquer outro valor (externo, "//host", vazio) vira null.
 */
export function safeInternalPath(value: string | null | undefined, origin?: string): string | null {
  if (!value) return null;
  let path = value;
  if (origin && value.startsWith(origin)) path = value.slice(origin.length) || "/";
  if (!path.startsWith("/") || path.startsWith("//") || path.startsWith("/\\")) return null;
  return path;
}

/** Permissão exigida por um caminho do painel (rota mais específica do mapa). */
export function permissionForPath(path: string): Permission | null {
  const pathname = path.split(/[?#]/)[0];
  const match = APP_ROUTES.filter(
    (route) => pathname === route.href || pathname.startsWith(`${route.href}/`),
  ).sort((a, b) => b.href.length - a.href.length)[0];
  return match?.permission ?? null;
}

/** Destino após o login: o caminho pedido, se interno e permitido ao perfil; senão a página inicial. */
export function landingPathFor(role: AppRole | null | undefined, requested: string | null): string {
  if (requested && (requested.startsWith("/admin") || /^\/pdv(?:[?#]|$)/.test(requested))) {
    const permission = permissionForPath(requested);
    if (permission && can(role, permission)) return requested;
  }
  return homePathFor(role);
}
