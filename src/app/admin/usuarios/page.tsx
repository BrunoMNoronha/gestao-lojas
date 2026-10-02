import { connection } from "next/server";
import { getUsers } from "@/actions/users";
import { requirePageAccess } from "@/lib/authz";
import { UsersManager } from "@/components/users-manager";

export const metadata = {
  title: "Usuários",
};

export default async function UsuariosPage() {
  await connection();
  const user = await requirePageAccess("users.manage");

  const users = await getUsers();

  return <UsersManager initialUsers={users} currentUserId={user.id} />;
}
