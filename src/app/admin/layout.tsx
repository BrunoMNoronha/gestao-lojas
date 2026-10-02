import { redirect } from "next/navigation";
import { AdminSidebar } from "@/components/admin-sidebar";
import { getSessionUser } from "@/lib/authz";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // O proxy já barra quem não está logado; aqui a sessão define o menu exibido para o perfil
  const user = await getSessionUser();
  if (!user) redirect("/login");

  return (
    <div className="flex min-h-screen bg-background">
      <AdminSidebar user={{ name: user.name, role: user.role }} />
      <main className="flex-1 p-8 overflow-y-auto">{children}</main>
    </div>
  );
}
