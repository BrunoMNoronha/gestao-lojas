import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/authz";
import { homePathFor } from "@/lib/permissions";

// O proxy já redireciona "/"; esta página garante o mesmo destino caso ele não seja executado.
export default async function Home() {
  const user = await getSessionUser();
  redirect(user ? homePathFor(user.role) : "/login");
}
