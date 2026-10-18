import Link from "next/link";
import { AlertTriangle, ArrowRight, ListChecks, Sparkles } from "lucide-react";
import type { DashboardInsight } from "@/actions/insights";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDayKeyBR, formatStoreDateTime } from "@/lib/store-time";

// Insights mais relevantes no Dashboard (issue #113): alertas mais graves e primeiras ações do
// último relatório salvo. Não chama o Claude; gerar e perguntar ficam em /admin/insights.

const SEVERITY = {
  alta: { label: "Alta", variant: "destructive" },
  media: { label: "Média", variant: "warning" },
  baixa: { label: "Baixa", variant: "info" },
} as const;

export function DashboardInsightsCard({ insight }: { insight: DashboardInsight }) {
  const latest = insight.latest;
  return (
    <Card>
      <CardHeader className="flex flex-col gap-2 pb-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="text-primary h-4 w-4" aria-hidden />
            Insights do Claude
          </CardTitle>
          <CardDescription>
            {latest
              ? `Análise de ${formatDayKeyBR(latest.periodFrom)} a ${formatDayKeyBR(latest.periodTo)}, gerada em ${formatStoreDateTime(latest.createdAt)}.`
              : "Nenhuma análise gerada ainda."}
          </CardDescription>
        </div>
        {insight.configured && (
          <Link
            href="/admin/insights"
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            {latest ? "Ver análise completa" : "Gerar análise"}
            <ArrowRight aria-hidden />
          </Link>
        )}
      </CardHeader>
      {latest && (
        <CardContent className="space-y-4">
          <p className="text-sm">{latest.resumo}</p>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <section aria-label="Alertas principais" className="space-y-2">
              <h3 className="flex items-center gap-2 text-sm font-medium">
                <AlertTriangle className="text-muted-foreground h-4 w-4" aria-hidden />
                Alertas
              </h3>
              {latest.alertas.length === 0 ? (
                <p className="text-muted-foreground text-sm">Nenhum alerta.</p>
              ) : (
                <ul className="space-y-2">
                  {latest.alertas.map((alerta, i) => (
                    <li key={i} className="space-y-0.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={SEVERITY[alerta.gravidade].variant}>
                          {SEVERITY[alerta.gravidade].label}
                        </Badge>
                        <span className="text-sm font-medium">{alerta.titulo}</span>
                      </div>
                      <p className="text-muted-foreground text-xs">{alerta.indicador}</p>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section aria-label="Próximas ações" className="space-y-2">
              <h3 className="flex items-center gap-2 text-sm font-medium">
                <ListChecks className="text-muted-foreground h-4 w-4" aria-hidden />
                Próximas ações
              </h3>
              {latest.acoes.length === 0 ? (
                <p className="text-muted-foreground text-sm">Nenhuma ação sugerida.</p>
              ) : (
                <ol className="space-y-2">
                  {latest.acoes.map((acao, i) => (
                    <li key={i} className="space-y-0.5">
                      <span className="text-sm font-medium">
                        {i + 1}. {acao.titulo}
                      </span>
                      <p className="text-muted-foreground text-xs">{acao.explicacao}</p>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </div>
        </CardContent>
      )}
    </Card>
  );
}
