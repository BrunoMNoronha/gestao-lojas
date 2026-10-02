import NextAuth from "next-auth";
import { authConfig } from "./auth.config";

// Next 16: a convenção `middleware` foi renomeada para `proxy`. Só redireciona por estado de
// login (callback `authorized` em auth.config.ts); permissões são verificadas no servidor.
export default NextAuth(authConfig).auth;

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
