import { Prisma, Role } from "@prisma/client";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";

// Cria o primeiro administrador quando o banco ainda não tem usuários.
// Módulo comum (sem "use server"): não é exposto como Server Action, só é chamado pelo
// fluxo de login em src/auth.ts.
//
// Produção: as credenciais vêm de ADMIN_EMAIL / ADMIN_PASSWORD (mínimo 12 caracteres) e
// ADMIN_NAME (opcional). Sem elas, nenhum usuário é criado.
// Desenvolvimento: sem as variáveis, usa o atalho local documentado em .env.example.

const MIN_PRODUCTION_PASSWORD_LENGTH = 12;
const DEV_FALLBACK_EMAIL = "admin@gestaolojas.com";
const DEV_FALLBACK_PASSWORD = "admin123";

interface AdminCredentials {
  name: string;
  email: string;
  password: string;
}

function resolveCredentials(): AdminCredentials | null {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  const name = process.env.ADMIN_NAME?.trim() || "Administrador";
  const isProduction = process.env.NODE_ENV === "production";

  if (email && password) {
    if (isProduction && password.length < MIN_PRODUCTION_PASSWORD_LENGTH) {
      console.error(
        `[bootstrap-admin] ADMIN_PASSWORD deve ter ao menos ${MIN_PRODUCTION_PASSWORD_LENGTH} caracteres em produção. Nenhum usuário foi criado.`,
      );
      return null;
    }
    return { name, email, password };
  }

  if (isProduction) {
    console.error(
      "[bootstrap-admin] Banco sem usuários e ADMIN_EMAIL/ADMIN_PASSWORD não definidos. Configure as variáveis de ambiente para criar o primeiro administrador.",
    );
    return null;
  }

  console.warn(
    `[bootstrap-admin] Desenvolvimento: criando administrador local padrão (${DEV_FALLBACK_EMAIL}). Defina ADMIN_EMAIL/ADMIN_PASSWORD para usar outras credenciais.`,
  );
  return { name, email: DEV_FALLBACK_EMAIL, password: DEV_FALLBACK_PASSWORD };
}

export async function bootstrapFirstAdmin(): Promise<void> {
  try {
    if ((await prisma.user.count()) > 0) return;

    const credentials = resolveCredentials();
    if (!credentials) return;

    const hashedPassword = await bcrypt.hash(credentials.password, 10);
    // upsert por e-mail: logins simultâneos com o banco vazio não criam dois administradores
    await prisma.user.upsert({
      where: { email: credentials.email },
      update: {},
      create: {
        name: credentials.name,
        email: credentials.email,
        password: hashedPassword,
        role: Role.ADMIN,
      },
    });
    console.info("[bootstrap-admin] Primeiro administrador criado.");
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return;
    console.error("[bootstrap-admin] Falha ao criar o primeiro administrador:", error);
  }
}
