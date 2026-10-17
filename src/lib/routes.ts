import {
  BarChart3,
  Boxes,
  ClipboardList,
  HandCoins,
  LayoutDashboard,
  Package,
  RefreshCw,
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

// Mapa central das rotas do painel: os menus (lateral, barra superior e paleta de comandos) e a
// checagem de acesso das páginas leem daqui.
export interface AppRoute {
  href: string;
  label: string;
  icon: LucideIcon;
  permission: Permission;
  // Fora dos menus (ex.: "Minha conta", acessada pelo menu do usuário)
  hidden?: boolean;
  // "topbar": atalho na barra superior do painel, fora do menu lateral (continua na paleta)
  placement?: "topbar";
  // Item que some do menu quando o recurso da loja está inativo (só visual: a página continua
  // protegida pela permissão)
  feature?: NavFeature;
}

// "onAccount": Contas a Receber, oculto com o fiado desligado e sem títulos a receber (issue #29)
// "catalog": link do catálogo público na barra superior, só com o catálogo ativo
export type NavFeature = "onAccount" | "catalog";

/** Recursos visíveis no menu; ausente ou true = exibido. */
export type NavFeatures = Partial<Record<NavFeature, boolean>>;

export const APP_ROUTES: AppRoute[] = [
  { href: "/admin", label: "Dashboard", icon: LayoutDashboard, permission: "dashboard.view" },
  { href: "/admin/pdv", label: "Frente de Caixa (PDV)", icon: ShoppingCart, permission: "pdv.use" },
  // PDV que abre sem internet depois da preparação (issue #37); fica fora do layout do /admin
  {
    href: "/pdv",
    label: "PDV sem internet",
    icon: WifiOff,
    permission: "pdv.use",
    placement: "topbar",
  },
  // Pedidos recebidos pelo catálogo público, carregados no PDV para virar venda (issue #81)
  {
    href: "/admin/pedidos",
    label: "Pedidos do catálogo",
    icon: ClipboardList,
    permission: "pdv.use",
  },
  { href: "/admin/caixa", label: "Caixa", icon: Wallet, permission: "cash.own" },
  // Conflitos, pendências e aparelhos das vendas feitas sem internet (issue #38)
  {
    href: "/admin/sincronizacao",
    label: "Sincronização offline",
    icon: RefreshCw,
    permission: "offline.reconcile",
    placement: "topbar",
  },
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

function visibleRoutes(role: AppRole | null | undefined, features: NavFeatures): AppRoute[] {
  return APP_ROUTES.filter(
    (route) =>
      !route.hidden &&
      can(role, route.permission) &&
      (!route.feature || features[route.feature] !== false),
  );
}

/** Rotas do menu lateral; com `includeTopbar`, também os atalhos da barra superior (paleta). */
export function routesFor(
  role: AppRole | null | undefined,
  features: NavFeatures = {},
  { includeTopbar = false }: { includeTopbar?: boolean } = {},
): AppRoute[] {
  return visibleRoutes(role, features).filter(
    (route) => includeTopbar || route.placement !== "topbar",
  );
}

/** Atalhos da barra superior do painel que o perfil pode ver. */
export function topbarRoutesFor(
  role: AppRole | null | undefined,
  features: NavFeatures = {},
): AppRoute[] {
  return visibleRoutes(role, features).filter((route) => route.placement === "topbar");
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
