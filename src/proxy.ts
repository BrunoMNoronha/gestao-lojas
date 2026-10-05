import NextAuth from "next-auth";
import { authConfig } from "./auth.config";

// Next 16: a convenção `middleware` foi renomeada para `proxy`. Só redireciona por estado de
// login (callback `authorized` em auth.config.ts); permissões são verificadas no servidor.
export default NextAuth(authConfig).auth;

export const config = {
  // /serwist (Service Worker) e o manifest são arquivos estáticos públicos: o proxy não precisa rodar
  matcher: [
    "/((?!api|_next/static|_next/image|serwist/|catalogo(?:/|$)|icons/|vendor/|manifest.webmanifest|favicon.ico).*)",
  ],
};
