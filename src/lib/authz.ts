import { cache } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { type AppRole, type Permission, can, isAppRole } from "@/lib/permissions";
import { INVALID_SESSION_LOGIN } from "@/lib/login-paths";

// Autorização no servidor (issue #14). Toda Server Action e toda página do painel passam por
// aqui: o proxy só redireciona quem não está logado, a permissão é sempre conferida no servidor.

export interface SessionUser {
  id: string;
  name: string;
  role: AppRole;
}

// `code` permite aos Route Handlers responder 401 (sem sessão) ou 403 (sem permissão)
export type AuthResult =
  | { ok: true; user: SessionUser }
  | { ok: false; error: string; code: "unauthenticated" | "forbidden" };

const SESSION_ERROR = "Sessão expirada. Faça login novamente.";
const PERMISSION_ERROR = "Você não tem permissão para realizar esta ação.";

/**
 * Usuário da sessão confirmado no banco: perfil atual e situação valem na hora (sem esperar novo
 * login). Usuário inativo ou removido é tratado como não autenticado. `cache` evita repetir a
 * consulta dentro da mesma requisição (layout + página + actions).
 */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const session = await auth();
  const id = session?.user?.id;
  if (!id) return null;

  const user = await prisma.user.findUnique({
    where: { id },
    select: { id: true, name: true, role: true, active: true },
  });
  if (!user || !user.active || !isAppRole(user.role)) return null;
  return { id: user.id, name: user.name, role: user.role };
});

/**
 * Para Server Actions e Route Handlers: exige sessão e, se informada, a permissão.
 * Uso: `const authz = await authorize("catalog.manage"); if (!authz.ok) return { success: false, error: authz.error };`
 */
export async function authorize(permission?: Permission): Promise<AuthResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: SESSION_ERROR, code: "unauthenticated" };
  if (permission && !can(user.role, permission)) {
    return { ok: false, error: PERMISSION_ERROR, code: "forbidden" };
  }
  return { ok: true, user };
}

/** Para páginas (Server Components): sem sessão vai ao login; sem permissão, à página 403. */
export async function requirePageAccess(permission: Permission): Promise<SessionUser> {
  const user = await getSessionUser();
  // O proxy já barra quem não tem sessão: sem usuário aqui, a sessão não vale mais
  if (!user) redirect(INVALID_SESSION_LOGIN);
  if (!can(user.role, permission)) redirect("/admin/acesso-negado");
  return user;
}
