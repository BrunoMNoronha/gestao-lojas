import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/authz";
import { homePathFor } from "@/lib/permissions";
import { INVALID_SESSION_LOGIN } from "@/lib/login-paths";

// Página inicial por perfil: decidida aqui (servidor) com o perfil atual do banco, já que o
// perfil gravado no token pode estar desatualizado após uma alteração pelo administrador.
export default async function Home() {
  const user = await getSessionUser();
  // Sem sessão o proxy já levou ao login; aqui, sem usuário, a sessão existe mas não vale mais
  redirect(user ? homePathFor(user.role) : INVALID_SESSION_LOGIN);
}
