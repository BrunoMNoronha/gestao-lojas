import type { DefaultSession } from "next-auth";
import type { AppRole } from "@/lib/permissions";

// Tipagem do perfil na sessão e no token (substitui os @ts-ignore de auth.config.ts)
declare module "next-auth" {
  interface User {
    role?: AppRole;
  }

  interface Session {
    user: {
      id: string;
      role: AppRole;
    } & DefaultSession["user"];
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    quickLoginContext?: string;
    id?: string;
    role?: AppRole;
  }
}
