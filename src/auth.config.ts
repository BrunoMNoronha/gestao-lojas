import type { NextAuthConfig } from "next-auth";
import { isAppRole } from "@/lib/permissions";

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

      if (pathname === "/") {
        return isLoggedIn ? true : Response.redirect(new URL("/login", nextUrl));
      }
      if (pathname.startsWith("/admin")) {
        return isLoggedIn; // false → redireciona para /login?callbackUrl=...
      }
      if (isLoggedIn && pathname === "/login") {
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
