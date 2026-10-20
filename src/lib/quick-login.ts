import { prisma } from "@/lib/prisma";
import { quickLoginContext } from "@/lib/quick-login-policy";
import { isAppRole, type AppRole } from "@/lib/permissions";

export interface QuickLoginUser {
  id: string;
  name: string;
  email: string;
  role: AppRole;
}
export type QuickLoginOptions =
  { enabled: false } | { enabled: true; users: QuickLoginUser[]; error?: string };
const selection = { id: true, name: true, email: true, role: true } as const;

// Funções internas do servidor; não são Server Actions nem API de gestão de usuários.
export async function getQuickLoginOptions(): Promise<QuickLoginOptions> {
  if (!quickLoginContext()) return { enabled: false };
  try {
    const users = await prisma.user.findMany({
      where: { active: true },
      select: selection,
      orderBy: [{ name: "asc" }, { id: "asc" }],
    });
    return { enabled: true, users: users.filter((u) => isAppRole(u.role)) };
  } catch {
    return {
      enabled: true,
      users: [],
      error:
        "Não foi possível carregar os usuários. Tente recarregar a página ou use o login com senha.",
    };
  }
}

export async function authorizeQuickLogin(userId: unknown): Promise<QuickLoginUser | null> {
  if (!quickLoginContext() || typeof userId !== "string" || !userId || userId.length > 128)
    return null;
  try {
    const user = await prisma.user.findFirst({
      where: { id: userId, active: true },
      select: selection,
    });
    return user && isAppRole(user.role) ? user : null;
  } catch {
    return null;
  }
}
