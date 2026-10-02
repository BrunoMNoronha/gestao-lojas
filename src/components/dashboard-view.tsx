import Link from "next/link";
import {
  AlertTriangle,
  BarChart3,
  CalendarDays,
  CalendarRange,
  HandCoins,
  ShoppingCart,
  Sun,
  Trophy,
  Wallet,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { DashboardMetrics, PeriodTotals } from "@/actions/reports";
import { PaymentMethodBars } from "@/components/payment-method-bars";
import { formatQuantity } from "@/lib/stock";
import { cn, formatCurrency } from "@/lib/utils";

function PeriodCard({
  title,
  icon: Icon,
  totals,
}: {
  title: string;
  icon: React.ElementType;
  totals: PeriodTotals;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <Icon className="text-muted-foreground h-4 w-4" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{formatCurrency(totals.total)}</div>
        <p className="text-muted-foreground mt-1 text-xs">
          {totals.count} {totals.count === 1 ? "venda" : "vendas"} · ticket médio{" "}
          {formatCurrency(totals.averageTicket)}
        </p>
      </CardContent>
    </Card>
  );
}

export function DashboardView({ metrics }: { metrics: DashboardMetrics }) {
  return (
    <div className="space-y-6">
      {/* Faturamento */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <PeriodCard title="Hoje" icon={Sun} totals={metrics.today} />
        <PeriodCard title="Semana (desde segunda)" icon={CalendarRange} totals={metrics.week} />
        <PeriodCard title="Mês atual" icon={CalendarDays} totals={metrics.month} />
      </div>
      <p className="text-muted-foreground -mt-3 text-xs">
        Faturamento = vendas registradas (líquidas de desconto), incluindo o Fiado. O dinheiro
        efetivamente recebido aparece no Caixa.
      </p>

      {/* Alertas */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Link href="/admin/contas-a-receber" className="group">
          <Card className="group-hover:border-primary/50 h-full transition-colors">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">Fiado em aberto</CardTitle>
              <HandCoins className="text-muted-foreground h-4 w-4" />
            </CardHeader>
            <CardContent>
              <div
                className={cn(
                  "text-2xl font-bold",
                  metrics.receivables.openTotal > 0 && "text-destructive",
                )}
              >
                {formatCurrency(metrics.receivables.openTotal)}
              </div>
              <p className="text-muted-foreground mt-1 text-xs">
                {metrics.receivables.openCount}{" "}
                {metrics.receivables.openCount === 1 ? "título" : "títulos"} ·{" "}
                {metrics.receivables.debtorCount}{" "}
                {metrics.receivables.debtorCount === 1 ? "cliente" : "clientes"}
              </p>
            </CardContent>
          </Card>
        </Link>
        <Link href="/admin/estoque" className="group">
          <Card className="group-hover:border-primary/50 h-full transition-colors">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">Abaixo do estoque mínimo</CardTitle>
              <AlertTriangle
                className={cn(
                  "h-4 w-4",
                  metrics.lowStockCount > 0 ? "text-destructive" : "text-muted-foreground",
                )}
              />
            </CardHeader>
            <CardContent>
              <div
                className={cn(
                  "text-2xl font-bold",
                  metrics.lowStockCount > 0 && "text-destructive",
                )}
              >
                {metrics.lowStockCount}
              </div>
              <p className="text-muted-foreground mt-1 text-xs">
                {metrics.lowStockCount === 1 ? "produto precisa" : "produtos precisam"} de reposição
              </p>
            </CardContent>
          </Card>
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <BarChart3 className="text-primary h-4 w-4" />
              Vendas por forma de pagamento
            </CardTitle>
            <CardDescription>Mês atual</CardDescription>
          </CardHeader>
          <CardContent>
            <PaymentMethodBars
              data={metrics.monthByMethod}
              emptyMessage="Nenhuma venda neste mês."
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Trophy className="text-primary h-4 w-4" />
              Produtos mais vendidos
            </CardTitle>
            <CardDescription>Mês atual, por faturamento</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {metrics.topProducts.length === 0 ? (
              <p className="text-muted-foreground px-6 py-6 text-center text-sm">
                Nenhuma venda neste mês.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10 text-center">#</TableHead>
                    <TableHead>Produto</TableHead>
                    <TableHead className="text-right">Quantidade</TableHead>
                    <TableHead className="text-right">Faturamento</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {metrics.topProducts.map((p, index) => (
                    <TableRow key={p.productId}>
                      <TableCell className="text-muted-foreground text-center">
                        {index + 1}
                      </TableCell>
                      <TableCell className="font-medium">{p.name}</TableCell>
                      <TableCell className="text-right font-mono">
                        {formatQuantity(p.quantity, p.unit)} {p.unit}
                      </TableCell>
                      <TableCell className="text-right font-mono font-semibold">
                        {formatCurrency(p.revenue)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Atalhos */}
      <div className="flex flex-wrap gap-2">
        <Link href="/admin/pdv">
          <Button variant="outline" className="gap-2">
            <ShoppingCart className="h-4 w-4" /> Frente de Caixa
          </Button>
        </Link>
        <Link href="/admin/caixa">
          <Button variant="outline" className="gap-2">
            <Wallet className="h-4 w-4" /> Caixa
          </Button>
        </Link>
        <Link href="/admin/relatorios/vendas">
          <Button variant="outline" className="gap-2">
            <BarChart3 className="h-4 w-4" /> Relatório de Vendas
          </Button>
        </Link>
      </div>
    </div>
  );
}
