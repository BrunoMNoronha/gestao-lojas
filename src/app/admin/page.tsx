import Link from "next/link";
import { getStoreSettings } from "@/actions/settings";
import { getDashboardMetrics } from "@/actions/reports";
import { Button } from "@/components/ui/button";
import { Settings } from "lucide-react";
import { connection } from "next/server";
import { DashboardView } from "@/components/dashboard-view";
import { requirePageAccess } from "@/lib/authz";

export const metadata = {
  title: "Painel de Controle",
};

export default async function AdminDashboardPage() {
  // Métricas mudam a cada venda: renderiza a cada requisição em vez de prerenderizar no build
  await connection();
  await requirePageAccess("dashboard.view");

  const [settings, metrics] = await Promise.all([getStoreSettings(), getDashboardMetrics()]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Painel de Controle</h1>
          <p className="text-sm text-muted-foreground">
            Bem-vindo ao sistema de gestão da <span className="font-semibold text-foreground">{settings.tradeName}</span>
          </p>
        </div>
        <Link href="/admin/configuracoes">
          <Button variant="outline" className="gap-2">
            <Settings className="w-4 h-4" />
            Configurar Loja
          </Button>
        </Link>
      </div>

      {metrics ? (
        <DashboardView metrics={metrics} />
      ) : (
        <div className="bg-card rounded-lg border p-6 text-center">
          <h2 className="text-lg font-semibold">Métricas indisponíveis</h2>
          <p className="text-muted-foreground mt-2 text-sm">
            Não foi possível carregar os indicadores. Verifique a conexão com o banco de dados e
            recarregue a página.
          </p>
        </div>
      )}
    </div>
  );
}
