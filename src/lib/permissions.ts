// Matriz de acesso por perfil (issue #14). Fonte única usada pelo menu, pelas páginas e pelas
// Server Actions. Para mudar o que um perfil pode fazer, altere apenas este mapa.

export type AppRole = "ADMIN" | "MANAGER" | "SELLER";

const ALL: AppRole[] = ["ADMIN", "MANAGER", "SELLER"];
const MANAGEMENT: AppRole[] = ["ADMIN", "MANAGER"];

export const PERMISSIONS = {
  "dashboard.view": MANAGEMENT,
  "reports.view": MANAGEMENT,
  "pdv.use": ALL,
  // Caixa do próprio operador: abrir, sangria, suprimento, fechar e ver o próprio histórico
  "cash.own": ALL,
  // Histórico e detalhe de caixas de outros operadores
  "cash.viewOthers": MANAGEMENT,
  "receivables.view": ALL,
  "receivables.pay": ALL,
  "catalog.view": ALL,
  "catalog.manage": MANAGEMENT,
  "stock.view": ALL,
  "stock.manage": MANAGEMENT,
  "customers.view": ALL,
  "customers.manage": ALL,
  "customers.delete": MANAGEMENT,
  "suppliers.manage": MANAGEMENT,
  // Conflitos e pendências das vendas offline: aprovar, descartar e dar ciência (issue #38)
  "offline.reconcile": MANAGEMENT,
  "settings.manage": ["ADMIN"],
  "users.manage": ["ADMIN"],
  // Página "Minha conta" (dados próprios e troca de senha)
  "account.self": ALL,
} as const satisfies Record<string, readonly AppRole[]>;

export type Permission = keyof typeof PERMISSIONS;

export const ROLE_LABELS: Record<AppRole, string> = {
  ADMIN: "Administrador",
  MANAGER: "Gerente",
  SELLER: "Vendedor",
};

export function isAppRole(value: unknown): value is AppRole {
  return value === "ADMIN" || value === "MANAGER" || value === "SELLER";
}

export function can(role: AppRole | null | undefined, permission: Permission): boolean {
  if (!role) return false;
  return (PERMISSIONS[permission] as readonly AppRole[]).includes(role);
}

/** Página inicial de cada perfil: gestão vê o Dashboard; vendedor vai direto ao PDV. */
export function homePathFor(role: AppRole | null | undefined): string {
  return can(role, "dashboard.view") ? "/admin" : "/admin/pdv";
}
