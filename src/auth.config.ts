import type { NextAuthConfig } from "next-auth";
import { homePathFor, isAppRole } from "@/lib/permissions";

export const authConfig = {
  pages: {
    signIn: "/login",
  },
  callbacks: {
    // Executado pelo proxy: apenas redireciona por estado de login. A permissão de cada área é
    // conferida no servidor (requirePageAccess / authorize em src/lib/authz.ts).
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user;
      const role = isAppRole(auth?.user?.role) ? auth.user.role : null;
      const { pathname } = nextUrl;

      if (pathname === "/") {
        return Response.redirect(new URL(isLoggedIn ? homePathFor(role) : "/login", nextUrl));
      }
      if (pathname.startsWith("/admin")) {
        return isLoggedIn; // false → redireciona para /login?callbackUrl=...
      }
      if (isLoggedIn && pathname === "/login") {
        return Response.redirect(new URL(homePathFor(role), nextUrl));
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
