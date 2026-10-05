import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/prisma";
import { verifyRecaptcha } from "@/lib/recaptcha";
import { LOGIN_ERROR_CODES, RECAPTCHA_LOGIN_ACTION } from "@/lib/recaptcha-shared";
import bcrypt from "bcryptjs";
import { authorizeQuickLogin } from "@/lib/quick-login";
import { authConfig } from "./auth.config";

// O `code` vai para a URL de resposta do Auth.js e permite à tela de login diferenciar a falha da
// verificação de segurança de "credenciais inválidas", sem revelar se o e-mail existe.
class RecaptchaRejected extends CredentialsSignin {
  code = LOGIN_ERROR_CODES.recaptchaRejected;
}

class RecaptchaUnavailable extends CredentialsSignin {
  code = LOGIN_ERROR_CODES.recaptchaUnavailable;
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  adapter: PrismaAdapter(prisma),
  session: { strategy: "jwt" },
  providers: [
    Credentials({
      id: "dev-quick-login",
      name: "Acesso rápido de testes",
      credentials: { userId: { type: "text" } },
      authorize: (credentials) => authorizeQuickLogin(credentials?.userId),
    }),
    Credentials({
      name: "Credentials",
      credentials: {
        email: { label: "E-mail", type: "email" },
        password: { label: "Senha", type: "password" },
        recaptchaToken: { type: "hidden" },
      },
      async authorize(credentials, request) {
        // O endpoint /api/auth/callback/credentials pode ser chamado direto, então a verificação
        // acontece aqui, antes do bootstrap e de qualquer consulta ao banco.
        const recaptcha = await verifyRecaptcha(credentials?.recaptchaToken, {
          requestUrl: request.url,
          expectedAction: RECAPTCHA_LOGIN_ACTION,
        });
        if (!recaptcha.ok) {
          throw recaptcha.reason === "unavailable"
            ? new RecaptchaUnavailable()
            : new RecaptchaRejected();
        }

        if (!credentials?.email || !credentials?.password) {
          return null;
        }

        const email = String(credentials.email).toLowerCase().trim();
        const password = String(credentials.password);

        try {
          const { bootstrapFirstAdmin } = await import("@/lib/bootstrap-admin");
          await bootstrapFirstAdmin();

          const user = await prisma.user.findUnique({
            where: { email },
          });

          // Usuário desativado recebe a mesma resposta de credenciais inválidas
          if (!user || !user.password || !user.active) {
            return null;
          }

          const passwordMatch = await bcrypt.compare(password, user.password);

          if (!passwordMatch) {
            return null;
          }

          return {
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role,
          };
        } catch (error) {
          console.error("Erro na autorização do usuário:", error);
          return null;
        }
      },
    }),
  ],
});
