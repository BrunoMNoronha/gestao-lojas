import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/authz";
import { homePathFor } from "@/lib/permissions";

// Página inicial por perfil: decidida aqui (servidor) com o perfil atual do banco, já que o
// perfil gravado no token pode estar desatualizado após uma alteração pelo administrador.
export default async function Home() {
  const user = await getSessionUser();
  redirect(user ? homePathFor(user.role) : "/login");
}
