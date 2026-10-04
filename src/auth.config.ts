import type { NextAuthConfig } from "next-auth";
import { isAppRole } from "@/lib/permissions";
import { INVALID_SESSION_PARAM } from "@/lib/login-paths";

export const authConfig = {
  pages: {
    signIn: "/login",
  },
  callbacks: {
    // Executado pelo proxy: apenas redireciona por estado de login. O perfil do token pode estar
    // desatualizado, então a página inicial e as permissões são decididas no servidor com o perfil
    // atual do banco (src/app/page.tsx, requirePageAccess / authorize em src/lib/authz.ts).
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user;
      const { pathname } = nextUrl;

      // Catálogo público (#17): aberto a visitantes; lê só campos públicos (src/lib/catalog.ts)
      if (pathname === "/catalogo" || pathname.startsWith("/catalogo/")) {
        return true;
      }
      if (pathname === "/") {
        return isLoggedIn ? true : Response.redirect(new URL("/login", nextUrl));
      }
      if (pathname.startsWith("/admin")) {
        return isLoggedIn; // false → redireciona para /login?callbackUrl=...
      }
      // Sessão que o servidor já recusou (usuário desativado): fica no login para entrar de novo
      if (isLoggedIn && pathname === "/login" && !nextUrl.searchParams.has(INVALID_SESSION_PARAM)) {
        return Response.redirect(new URL("/", nextUrl));
      }
      return true;
    },
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = user.role;
      }
      return token;
    },
    async session({ session, token }) {
      if (token && session.user) {
        session.user.id = token.id as string;
        if (isAppRole(token.role)) session.user.role = token.role;
      }
      return session;
    },
  },
  providers: [],
} satisfies NextAuthConfig;
