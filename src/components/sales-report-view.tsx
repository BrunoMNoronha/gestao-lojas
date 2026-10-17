"use client";

import { useState } from "react";
import { BarChart3, CalendarDays, Loader2, Receipt } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { SalesReport, getSalesReport } from "@/actions/reports";
import { CashOperator } from "@/actions/cash-register";
import type { StoreSettingsData } from "@/actions/settings";
import { SaleDetailDialog } from "@/components/sale-detail-dialog";
import { PaymentMethodBars } from "@/components/payment-method-bars";
import { PAYMENT_METHOD_LABELS, PaymentMethodValue } from "@/lib/payments";
import { formatDayKeyBR, formatStoreDateTime } from "@/lib/store-time";
import { cn, formatCurrency } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { OptionSelect } from "@/components/option-select";
import { DateRangePicker } from "@/components/date-range-picker";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/page-header";

interface SalesReportViewProps {
  operators: CashOperator[];
  initialFilters: { from: string; to: string };
  initialReport: SalesReport;
  storeSettings: StoreSettingsData;
}

interface Filters {
  from: string;
  to: string;
  paymentMethod: "" | PaymentMethodValue;
  userId: string;
}

const PAGE_SIZE = 50;

function TotalCard({ title, value, hint }: { title: string; value: string; hint?: string }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        {hint && <p className="text-muted-foreground mt-1 text-xs">{hint}</p>}
      </CardContent>
    </Card>
  );
}

export function SalesReportView({
  operators,
  initialFilters,
  initialReport,
  storeSettings,
}: SalesReportViewProps) {
  const [filters, setFilters] = useState<Filters>({
    ...initialFilters,
    paymentMethod: "",
    userId: "",
  });
  const [report, setReport] = useState<SalesReport>(initialReport);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [dialogKey, setDialogKey] = useState(0);

  const openDetail = (id: string) => {
    setDialogKey((k) => k + 1);
    setDetailId(id);
  };

  const load = async (next: Filters, append = false) => {
    setLoading(true);
    const res = await getSalesReport({
      from: next.from,
      to: next.to,
      paymentMethod: next.paymentMethod || null,
      userId: next.userId || null,
      take: PAGE_SIZE,
      skip: append ? report.sales.length : 0,
    });
    setLoading(false);

    if (!res.success || !res.data) {
      setError(res.error || "Falha ao gerar o relatório.");
      return;
    }
    setError(null);
    const data = res.data;
    setReport((prev) => (append ? { ...data, sales: [...prev.sales, ...data.sales] } : data));
  };

  const updateFilters = (patch: Partial<Filters>) => {
    const next = { ...filters, ...patch };
    setFilters(next);
    if (next.from && next.to) load(next);
  };

  const maxDaily = Math.max(...report.daily.map((d) => d.total), 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Relatório de Vendas"
        icon={BarChart3}
        description="Faturamento = vendas registradas (líquidas de desconto), incluindo o Fiado. Vendas estornadas aparecem na lista, mas ficam fora dos totais. Datas no horário da loja."
      />

      {/* Filters */}
      <Card>
        <CardContent className="grid grid-cols-1 items-end gap-3 p-4 sm:grid-cols-2 lg:grid-cols-[1.5fr_1fr_1fr]">
          <div className="space-y-1 sm:col-span-2 lg:col-span-1">
            <Label
              htmlFor="sales-report-view-periodo"
              className="text-muted-foreground text-xs font-medium"
            >
              Período
            </Label>
            <DateRangePicker
              id="sales-report-view-periodo"
              from={filters.from}
              to={filters.to}
              onChange={(range) => updateFilters(range)}
            />
          </div>
          <div className="space-y-1">
            <Label
              htmlFor="sales-report-view-forma-de-pagamento"
              className="text-muted-foreground text-xs font-medium"
            >
              Forma de pagamento
            </Label>
            <OptionSelect
              id="sales-report-view-forma-de-pagamento"
              value={filters.paymentMethod}
              onValueChange={(v) => updateFilters({ paymentMethod: v as Filters["paymentMethod"] })}
              options={[
                { value: "", label: "Todas" },
                ...(Object.keys(PAYMENT_METHOD_LABELS) as PaymentMethodValue[]).map((m) => ({
                  value: m,
                  label: PAYMENT_METHOD_LABELS[m],
                })),
              ]}
            />
          </div>
          <div className="space-y-1">
            <Label
              htmlFor="sales-report-view-operador"
              className="text-muted-foreground text-xs font-medium"
            >
              Operador
            </Label>
            <OptionSelect
              id="sales-report-view-operador"
              value={filters.userId}
              onValueChange={(v) => updateFilters({ userId: v })}
              options={[
                { value: "", label: "Todos" },
                ...operators.map((o) => ({ value: o.id, label: o.name })),
              ]}
            />
          </div>
        </CardContent>
      </Card>

      {error && (
        <div className="text-destructive bg-destructive/10 border-destructive/20 rounded-md border p-3 text-sm">
          {error}
        </div>
      )}

      <div className={loading ? "space-y-6 opacity-60" : "space-y-6"}>
        {/* Totals */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <TotalCard title="Faturamento" value={formatCurrency(report.totals.total)} />
          <TotalCard title="Vendas" value={String(report.totals.count)} />
          <TotalCard title="Ticket médio" value={formatCurrency(report.totals.averageTicket)} />
          <TotalCard title="Descontos concedidos" value={formatCurrency(report.totals.discount)} />
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Por forma de pagamento</CardTitle>
            </CardHeader>
            <CardContent>
              <PaymentMethodBars data={report.byMethod} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <CalendarDays className="text-primary h-4 w-4" />
                Faturamento por dia
              </CardTitle>
              <CardDescription>Somente dias com vendas</CardDescription>
            </CardHeader>
            <CardContent>
              {report.daily.length === 0 ? (
                <p className="text-muted-foreground py-6 text-center text-sm">
                  Nenhuma venda no período.
                </p>
              ) : (
                <ul className="max-h-80 space-y-2 overflow-y-auto pr-1">
                  {report.daily.map((d) => (
                    <li key={d.day} className="grid grid-cols-[5.5rem_1fr_auto] items-center gap-3">
                      <span className="text-muted-foreground font-mono text-xs">
                        {formatDayKeyBR(d.day)}
                      </span>
                      <div
                        className="bg-muted h-2.5 overflow-hidden rounded-full"
                        aria-hidden="true"
                      >
                        <div
                          className="bg-primary h-full rounded-full"
                          style={{
                            width: `${maxDaily > 0 ? Math.max((d.total / maxDaily) * 100, 2) : 0}%`,
                          }}
                        />
                      </div>
                      <span className="text-right text-xs">
                        <span className="font-mono text-sm font-semibold">
                          {formatCurrency(d.total)}
                        </span>{" "}
                        <span className="text-muted-foreground">({d.count})</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Sales list */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Receipt className="text-primary h-4 w-4" />
              Vendas do período
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {report.sales.length === 0 ? (
              <p className="text-muted-foreground px-6 pb-6 text-center text-sm">
                Nenhuma venda encontrada para os filtros selecionados.
              </p>
            ) : (
              <>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Venda</TableHead>
                      <TableHead>Data</TableHead>
                      <TableHead>Operador</TableHead>
                      <TableHead>Cliente</TableHead>
                      <TableHead>Forma</TableHead>
                      <TableHead className="text-right">Desconto</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead className="w-0" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {report.sales.map((s) => (
                      <TableRow key={s.id}>
                        <TableCell className="font-mono whitespace-nowrap">
                          #{s.code}
                          {s.reversed && (
                            <Badge variant="destructive" className="ml-2 font-sans text-[11px]">
                              Estornada
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-xs whitespace-nowrap">
                          {formatStoreDateTime(s.occurredAt)}
                        </TableCell>
                        <TableCell className="text-sm">{s.userName}</TableCell>
                        <TableCell className="text-sm">
                          {s.customerName ?? (
                            <span className="text-muted-foreground">Consumidor final</span>
                          )}
                        </TableCell>
                        <TableCell className="text-sm">
                          {PAYMENT_METHOD_LABELS[s.paymentMethod]}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-right font-mono">
                          {s.discount > 0 ? formatCurrency(s.discount) : "-"}
                        </TableCell>
                        <TableCell
                          className={cn(
                            "text-right font-mono font-semibold",
                            s.reversed && "text-muted-foreground line-through",
                          )}
                        >
                          {formatCurrency(s.total)}
                        </TableCell>
                        <TableCell className="text-center">
                          <Button size="sm" variant="outline" onClick={() => openDetail(s.id)}>
                            Ver
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <div className="text-muted-foreground flex items-center justify-between border-t px-4 py-3 text-xs">
                  <span>
                    Exibindo {report.sales.length} de {report.salesTotal} vendas
                  </span>
                  {report.sales.length < report.salesTotal && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => load(filters, true)}
                      disabled={loading}
                    >
                      {loading && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                      Carregar mais
                    </Button>
                  )}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <SaleDetailDialog
        key={`sale-${dialogKey}`}
        open={detailId !== null}
        onOpenChange={(open) => !open && setDetailId(null)}
        saleId={detailId}
        storeSettings={storeSettings}
        onReversed={() => load(filters)}
      />
    </div>
  );
}
