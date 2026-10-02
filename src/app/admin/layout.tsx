import { redirect } from "next/navigation";
import { AdminMobileHeader, AdminSidebar } from "@/components/admin-sidebar";
import { getSessionUser } from "@/lib/authz";
import { getStoreBrandName } from "@/lib/store-brand";
import { isReceivablesVisible } from "@/lib/on-account";
import { can } from "@/lib/permissions";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // O proxy já barra quem não está logado; aqui a sessão define o menu exibido para o perfil
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const [storeName, showReceivables] = await Promise.all([
    getStoreBrandName(),
    // Só consulta o banco para quem vê o item no menu
    can(user.role, "receivables.view") ? isReceivablesVisible() : true,
  ]);
  const navProps = {
    user: { name: user.name, role: user.role },
    storeName,
    features: { onAccount: showReceivables },
  };

  return (
    <div className="bg-background flex min-h-screen">
      <a
        href="#conteudo"
        className="focus:bg-primary focus:text-primary-foreground sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:px-3 focus:py-2 focus:text-sm"
      >
        Pular para o conteúdo
      </a>
      <AdminSidebar {...navProps} />
      <div className="flex min-w-0 flex-1 flex-col">
        <AdminMobileHeader {...navProps} />
        {/* min-w-0 permite que tabelas largas rolem dentro do próprio contêiner */}
        <main id="conteudo" className="min-w-0 flex-1 p-4 sm:p-6 lg:p-8">
          {children}
        </main>
      </div>
    </div>
  );
}
