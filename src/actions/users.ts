"use server";

import { prisma } from "@/lib/prisma";
import { authorize } from "@/lib/authz";
import { revalidatePath } from "next/cache";
import { Prisma, Role } from "@prisma/client";
import bcrypt from "bcryptjs";
import { type AppRole, isAppRole } from "@/lib/permissions";

// Gestão de usuários (issue #16). Senhas e hashes nunca saem do servidor nem vão para logs.

export interface UserItem {
  id: string;
  name: string;
  email: string;
  role: AppRole;
  active: boolean;
  createdAt: string;
}

export interface UserFilters {
  search?: string | null;
  role?: AppRole | null;
  active?: boolean | null;
}

export interface UserInput {
  name: string;
  email: string;
  role: AppRole;
}

// Padrão de retorno das Server Actions do projeto
export interface ActionResult<T = undefined> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface MyAccount {
  name: string;
  email: string;
  role: AppRole;
}

const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 72; // limite do bcrypt
const MAX_NAME_LENGTH = 100;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Erro de regra de negócio: a mensagem é segura para exibir ao usuário.
class UserValidationError extends Error {}

const userSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  active: true,
  createdAt: true,
} satisfies Prisma.UserSelect;

function toUserItem(u: Prisma.UserGetPayload<{ select: typeof userSelect }>): UserItem {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role as AppRole,
    active: u.active,
    createdAt: u.createdAt.toISOString(),
  };
}

function parseUserInput(data: UserInput): { name: string; email: string; role: Role } {
  const name = typeof data?.name === "string" ? data.name.trim() : "";
  if (!name) throw new UserValidationError("O nome é obrigatório.");
  if (name.length > MAX_NAME_LENGTH) {
    throw new UserValidationError(`O nome deve ter até ${MAX_NAME_LENGTH} caracteres.`);
  }
  const email = typeof data?.email === "string" ? data.email.trim().toLowerCase() : "";
  if (!EMAIL_PATTERN.test(email)) throw new UserValidationError("Informe um e-mail válido.");
  if (!isAppRole(data?.role)) throw new UserValidationError("Perfil inválido.");
  return { name, email, role: data.role as Role };
}

function parsePassword(value: unknown, label = "A senha"): string {
  if (typeof value !== "string" || value.length < MIN_PASSWORD_LENGTH) {
    throw new UserValidationError(`${label} deve ter no mínimo ${MIN_PASSWORD_LENGTH} caracteres.`);
  }
  if (value.length > MAX_PASSWORD_LENGTH) {
    throw new UserValidationError(`${label} deve ter no máximo ${MAX_PASSWORD_LENGTH} caracteres.`);
  }
  return value;
}

function isUniqueEmailViolation(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

// Impede que o sistema fique sem nenhum ADMIN ativo (conta os demais administradores ativos)
async function assertAnotherActiveAdmin(tx: Prisma.TransactionClient, userId: string) {
  const others = await tx.user.count({
    where: { role: Role.ADMIN, active: true, id: { not: userId } },
  });
  if (others === 0) {
    throw new UserValidationError("O sistema precisa manter ao menos um administrador ativo.");
  }
}

// Só nome/código do erro vão para o log: mensagens do Prisma podem conter os dados enviados
function errorTag(error: unknown) {
  if (error instanceof Prisma.PrismaClientKnownRequestError) return error.code;
  return error instanceof Error ? error.name : "erro desconhecido";
}

function handleError(error: unknown, fallback: string): ActionResult<never> {
  if (error instanceof UserValidationError) return { success: false, error: error.message };
  if (isUniqueEmailViolation(error)) {
    return { success: false, error: "Já existe um usuário com este e-mail." };
  }
  // Conflito de transação serializável (alteração simultânea)
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
    return { success: false, error: "Outro usuário alterou estes dados agora. Tente novamente." };
  }
  console.error(fallback, errorTag(error));
  return { success: false, error: fallback };
}

// Regras de "último administrador" exigem isolamento serializável contra alterações simultâneas
const SERIALIZABLE = { isolationLevel: Prisma.TransactionIsolationLevel.Serializable };

export async function getUsers(filters: UserFilters = {}): Promise<UserItem[]> {
  try {
    const authz = await authorize("users.manage");
    if (!authz.ok) return [];

    const where: Prisma.UserWhereInput = {};
    const search = filters.search?.trim();
    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { email: { contains: search, mode: "insensitive" } },
      ];
    }
    if (isAppRole(filters.role)) where.role = filters.role;
    if (typeof filters.active === "boolean") where.active = filters.active;

    const users = await prisma.user.findMany({
      where,
      select: userSelect,
      orderBy: [{ active: "desc" }, { name: "asc" }],
    });
    return users.map(toUserItem);
  } catch (error) {
    console.error("Erro ao listar usuários:", errorTag(error));
    return [];
  }
}

export async function createUser(
  data: UserInput & { password: string },
): Promise<ActionResult<UserItem>> {
  try {
    const authz = await authorize("users.manage");
    if (!authz.ok) return { success: false, error: authz.error };

    const input = parseUserInput(data);
    const password = parsePassword(data?.password);

    const user = await prisma.user.create({
      data: { ...input, password: await bcrypt.hash(password, 10) },
      select: userSelect,
    });

    revalidatePath("/admin/usuarios");
    return { success: true, data: toUserItem(user) };
  } catch (error) {
    return handleError(error, "Falha ao criar o usuário.");
  }
}

export async function updateUser(id: string, data: UserInput): Promise<ActionResult<UserItem>> {
  try {
    const authz = await authorize("users.manage");
    if (!authz.ok) return { success: false, error: authz.error };
    if (typeof id !== "string" || !id) return { success: false, error: "Usuário inválido." };

    const input = parseUserInput(data);

    const user = await prisma.$transaction(async (tx) => {
      const current = await tx.user.findUnique({
        where: { id },
        select: { id: true, role: true, active: true },
      });
      if (!current) throw new UserValidationError("Usuário não encontrado.");

      if (current.role !== input.role) {
        if (id === authz.user.id) {
          throw new UserValidationError("Você não pode alterar o seu próprio perfil.");
        }
        if (current.role === Role.ADMIN && current.active) {
          await assertAnotherActiveAdmin(tx, id);
        }
      }

      return tx.user.update({ where: { id }, data: input, select: userSelect });
    }, SERIALIZABLE);

    revalidatePath("/admin/usuarios");
    return { success: true, data: toUserItem(user) };
  } catch (error) {
    return handleError(error, "Falha ao atualizar o usuário.");
  }
}

export async function setUserActive(id: string, active: boolean): Promise<ActionResult> {
  try {
    const authz = await authorize("users.manage");
    if (!authz.ok) return { success: false, error: authz.error };
    if (typeof id !== "string" || !id || typeof active !== "boolean") {
      return { success: false, error: "Dados inválidos." };
    }
    if (!active && id === authz.user.id) {
      return { success: false, error: "Você não pode desativar o seu próprio usuário." };
    }

    await prisma.$transaction(async (tx) => {
      const current = await tx.user.findUnique({
        where: { id },
        select: { role: true, active: true },
      });
      if (!current) throw new UserValidationError("Usuário não encontrado.");
      if (!active && current.active && current.role === Role.ADMIN) {
        await assertAnotherActiveAdmin(tx, id);
      }
      await tx.user.update({ where: { id }, data: { active } });
    }, SERIALIZABLE);

    revalidatePath("/admin/usuarios");
    return { success: true };
  } catch (error) {
    return handleError(error, "Falha ao alterar a situação do usuário.");
  }
}

export async function resetUserPassword(id: string, newPassword: string): Promise<ActionResult> {
  try {
    const authz = await authorize("users.manage");
    if (!authz.ok) return { success: false, error: authz.error };
    if (typeof id !== "string" || !id) return { success: false, error: "Usuário inválido." };
    if (id === authz.user.id) {
      return { success: false, error: "Para trocar a sua senha, use a página Minha conta." };
    }

    const password = parsePassword(newPassword, "A nova senha");
    const updated = await prisma.user.updateMany({
      where: { id },
      data: { password: await bcrypt.hash(password, 10) },
    });
    if (updated.count === 0) return { success: false, error: "Usuário não encontrado." };

    return { success: true };
  } catch (error) {
    return handleError(error, "Falha ao redefinir a senha.");
  }
}

export async function getMyAccount(): Promise<MyAccount | null> {
  try {
    const authz = await authorize("account.self");
    if (!authz.ok) return null;

    const user = await prisma.user.findUnique({
      where: { id: authz.user.id },
      select: { name: true, email: true, role: true },
    });
    return user ? { name: user.name, email: user.email, role: user.role as AppRole } : null;
  } catch (error) {
    console.error("Erro ao carregar a conta:", errorTag(error));
    return null;
  }
}

export async function changeOwnPassword(data: {
  currentPassword: string;
  newPassword: string;
}): Promise<ActionResult> {
  try {
    const authz = await authorize("account.self");
    if (!authz.ok) return { success: false, error: authz.error };

    const newPassword = parsePassword(data?.newPassword, "A nova senha");
    if (typeof data?.currentPassword !== "string" || !data.currentPassword) {
      return { success: false, error: "Informe a senha atual." };
    }

    const user = await prisma.user.findUnique({
      where: { id: authz.user.id },
      select: { password: true },
    });
    if (!user || !(await bcrypt.compare(data.currentPassword, user.password))) {
      return { success: false, error: "A senha atual está incorreta." };
    }
    if (await bcrypt.compare(newPassword, user.password)) {
      return { success: false, error: "A nova senha deve ser diferente da atual." };
    }

    await prisma.user.update({
      where: { id: authz.user.id },
      data: { password: await bcrypt.hash(newPassword, 10) },
    });
    return { success: true };
  } catch (error) {
    return handleError(error, "Falha ao trocar a senha.");
  }
}
