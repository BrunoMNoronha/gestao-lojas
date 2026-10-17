import NextAuth from "next-auth";
import { authConfig } from "./auth.config";

// Next 16: a convenção `middleware` foi renomeada para `proxy`. Só redireciona por estado de
// login (callback `authorized` em auth.config.ts); permissões são verificadas no servidor.
export default NextAuth(authConfig).auth;

export const config = {
  // /serwist (Service Worker), manifest e ícones são arquivos públicos: o proxy não precisa rodar.
  // Nem na landing "/" (`|$`), que é estática e pública: assim ela sai direto da CDN.
  matcher: [
    "/((?!api|_next/static|_next/image|serwist/|catalogo(?:/|$)|icons/|vendor/|videos/|manifest.webmanifest|favicon.ico|icon.svg|$).*)",
  ],
};
