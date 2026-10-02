import Link from "next/link";
import { getStoreSettings } from "@/actions/settings";
import { getDashboardMetrics } from "@/actions/reports";
import { buttonVariants } from "@/components/ui/button";
import { DatabaseZap, LayoutDashboard, Settings } from "lucide-react";
import { connection } from "next/server";
import { DashboardView } from "@/components/dashboard-view";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { requirePageAccess } from "@/lib/authz";
import { can } from "@/lib/permissions";

export const metadata = {
  title: "Painel de Controle",
};

export default async function AdminDashboardPage() {
  // Métricas mudam a cada venda: renderiza a cada requisição em vez de prerenderizar no build
  await connection();
  const user = await requirePageAccess("dashboard.view");

  const [settings, metrics] = await Promise.all([getStoreSettings(), getDashboardMetrics()]);
  // Card "Fiado em aberto": some com o fiado desligado e nenhum título a receber
  const showReceivables =
    settings.onAccountEnabled !== false || (metrics?.receivables.openCount ?? 0) > 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Painel de Controle"
        icon={LayoutDashboard}
        description={
          <>
            Bem-vindo ao sistema de gestão da{" "}
            <span className="text-foreground font-semibold">{settings.tradeName}</span>
          </>
        }
        actions={
          can(user.role, "settings.manage") && (
            <Link href="/admin/configuracoes" className={buttonVariants({ variant: "outline" })}>
              <Settings />
              Configurar Loja
            </Link>
          )
        }
      />

      {metrics ? (
        <DashboardView metrics={metrics} showReceivables={showReceivables} />
      ) : (
        <EmptyState
          icon={DatabaseZap}
          tone="destructive"
          title="Métricas indisponíveis"
          description="Não foi possível carregar os indicadores. Verifique a conexão com o banco de dados e recarregue a página."
        />
      )}
    </div>
  );
}
