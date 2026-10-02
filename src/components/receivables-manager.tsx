"use client";

import { Fragment, useState } from "react";
import { useRouter } from "next/navigation";
import { HandCoins, Users, Wallet, Loader2, X, ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CustomerItem } from "@/actions/customers";
import {
  ReceivableItem,
  ReceivableStatusValue,
  ReceivablesSummary,
  getReceivables,
} from "@/actions/receivables";
import { ReceivablePaymentDialog } from "@/components/receivable-payment-dialog";
import { PAYMENT_METHOD_LABELS, RECEIVABLE_STATUS_LABELS } from "@/lib/payments";
import { formatDate, formatDateTime } from "@/lib/dates";
import { cn, formatCurrency } from "@/lib/utils";

interface ReceivablesManagerProps {
  customers: CustomerItem[];
  summary: ReceivablesSummary;
  initialReceivables: { items: ReceivableItem[]; total: number };
  hasOpenCashRegister: boolean;
}

interface Filters {
  customerId: string;
  status: "" | ReceivableStatusValue;
}

const PAGE_SIZE = 50;
const EMPTY_FILTERS: Filters = { customerId: "", status: "" };

const selectClassName =
  "w-full h-8 px-2.5 text-sm rounded-lg border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring";

function StatusBadge({ status }: { status: ReceivableStatusValue }) {
  const className = {
    OPEN: "text-destructive border-destructive/30 bg-destructive/5",
    PARTIAL:
      "text-amber-600 border-amber-600/30 bg-amber-50/50 dark:bg-amber-950/20 dark:text-amber-400",
    PAID: "text-emerald-600 border-emerald-600/30 bg-emerald-50/50 dark:bg-emerald-950/20 dark:text-emerald-400",
  }[status];
  return (
    <Badge variant="outline" className={cn("text-[11px]", className)}>
      {RECEIVABLE_STATUS_LABELS[status]}
    </Badge>
  );
}

export function ReceivablesManager({
  customers,
  summary,
  initialReceivables,
  hasOpenCashRegister,
}: ReceivablesManagerProps) {
  const router = useRouter();

  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [receivables, setReceivables] = useState(initialReceivables);
  const [loading, setLoading] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Trocar a key remonta o diálogo e reinicia o formulário a cada abertura
  const [dialogKey, setDialogKey] = useState(0);
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [selected, setSelected] = useState<ReceivableItem | null>(null);

  const hasFilters = Object.values(filters).some(Boolean);

  const loadReceivables = async (next: Filters, append = false) => {
    setLoading(true);
    const page = await getReceivables({
      customerId: next.customerId || null,
      status: next.status || null,
      take: PAGE_SIZE,
      skip: append ? receivables.items.length : 0,
    });
    setReceivables((prev) =>
      append ? { items: [...prev.items, ...page.items], total: page.total } : page,
    );
    setLoading(false);
  };

  const updateFilters = (patch: Partial<Filters>) => {
    const next = { ...filters, ...patch };
    setFilters(next);
    loadReceivables(next);
  };

  const openPaymentDialog = (receivable: ReceivableItem) => {
    setDialogKey((k) => k + 1);
    setSelected(receivable);
    setPaymentDialogOpen(true);
  };

  const handlePaymentSuccess = () => {
    router.refresh();
    loadReceivables(filters);
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
          <HandCoins className="text-primary h-6 w-6" />
          Contas a Receber
        </h1>
        <p className="text-muted-foreground text-sm">Vendas no Fiado e recebimentos de clientes.</p>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Total em aberto</CardTitle>
            <Wallet className="text-muted-foreground h-4 w-4" />
          </CardHeader>
          <CardContent>
            <div className={cn("text-2xl font-bold", summary.openTotal > 0 && "text-destructive")}>
              {formatCurrency(summary.openTotal)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Títulos em aberto</CardTitle>
            <HandCoins className="text-muted-foreground h-4 w-4" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary.openCount}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Clientes devedores</CardTitle>
            <Users className="text-muted-foreground h-4 w-4" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary.debtorCount}</div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="grid grid-cols-1 items-end gap-3 p-4 sm:grid-cols-[2fr_1fr_auto]">
          <div className="space-y-1">
            <label className="text-muted-foreground text-xs font-medium">Cliente</label>
            <select
              className={selectClassName}
              value={filters.customerId}
              onChange={(e) => updateFilters({ customerId: e.target.value })}
            >
              <option value="">Todos os clientes</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-muted-foreground text-xs font-medium">Situação</label>
            <select
              className={selectClassName}
              value={filters.status}
              onChange={(e) => updateFilters({ status: e.target.value as Filters["status"] })}
            >
              <option value="">Todas</option>
              <option value="OPEN">Em aberto</option>
              <option value="PARTIAL">Parcial</option>
              <option value="PAID">Quitado</option>
            </select>
          </div>
          <Button
            variant="ghost"
            onClick={() => {
              setFilters(EMPTY_FILTERS);
              loadReceivables(EMPTY_FILTERS);
            }}
            disabled={!hasFilters}
            className="gap-1"
          >
            <X className="h-4 w-4" />
            Limpar
          </Button>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {receivables.items.length === 0 ? (
            <div className="flex flex-col items-center justify-center p-12 text-center">
              {loading ? (
                <Loader2 className="text-muted-foreground h-8 w-8 animate-spin" />
              ) : (
                <>
                  <HandCoins className="text-muted-foreground/50 mb-3 h-12 w-12" />
                  <h3 className="text-base font-semibold">Nenhum título encontrado</h3>
                  <p className="text-muted-foreground mt-1 max-w-sm text-sm">
                    {hasFilters
                      ? "Tente ajustar os filtros."
                      : "Vendas no Fiado feitas no PDV aparecerão aqui."}
                  </p>
                </>
              )}
            </div>
          ) : (
            <>
              <Table className={loading ? "opacity-60" : undefined}>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8" />
                    <TableHead>Cliente</TableHead>
                    <TableHead>Venda</TableHead>
                    <TableHead className="text-right">Valor</TableHead>
                    <TableHead className="text-right">Pago</TableHead>
                    <TableHead className="text-right">Saldo</TableHead>
                    <TableHead className="text-center">Situação</TableHead>
                    <TableHead className="text-center">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {receivables.items.map((r) => {
                    const expanded = expandedId === r.id;
                    return (
                      <Fragment key={r.id}>
                        <TableRow>
                          <TableCell>
                            {r.payments.length > 0 && (
                              <Button
                                size="icon-sm"
                                variant="ghost"
                                onClick={() => setExpandedId(expanded ? null : r.id)}
                                title="Ver recebimentos"
                              >
                                {expanded ? (
                                  <ChevronDown className="h-4 w-4" />
                                ) : (
                                  <ChevronRight className="h-4 w-4" />
                                )}
                              </Button>
                            )}
                          </TableCell>
                          <TableCell className="font-medium">{r.customerName}</TableCell>
                          <TableCell className="text-sm" suppressHydrationWarning>
                            #{r.saleCode}{" "}
                            <span className="text-muted-foreground text-xs">
                              {formatDate(r.saleDate)}
                            </span>
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {formatCurrency(r.amount)}
                          </TableCell>
                          <TableCell className="text-muted-foreground text-right font-mono">
                            {formatCurrency(r.paidAmount)}
                          </TableCell>
                          <TableCell
                            className={cn(
                              "text-right font-mono font-semibold",
                              r.balance > 0 && "text-destructive",
                            )}
                          >
                            {formatCurrency(r.balance)}
                          </TableCell>
                          <TableCell className="text-center">
                            <StatusBadge status={r.status} />
                          </TableCell>
                          <TableCell className="text-center">
                            {r.balance > 0 && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => openPaymentDialog(r)}
                              >
                                Receber
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                        {expanded && (
                          <TableRow className="bg-muted/30 hover:bg-muted/30">
                            <TableCell />
                            <TableCell colSpan={7}>
                              <ul className="space-y-1 text-xs">
                                {r.payments.map((p) => (
                                  <li key={p.id} className="flex gap-4">
                                    <span
                                      className="text-muted-foreground"
                                      suppressHydrationWarning
                                    >
                                      {formatDateTime(p.createdAt)}
                                    </span>
                                    <span>{PAYMENT_METHOD_LABELS[p.method]}</span>
                                    <span className="font-mono">{formatCurrency(p.amount)}</span>
                                    <span className="text-muted-foreground">{p.userName}</span>
                                  </li>
                                ))}
                              </ul>
                            </TableCell>
                          </TableRow>
                        )}
                      </Fragment>
                    );
                  })}
                </TableBody>
              </Table>

              <div className="text-muted-foreground flex items-center justify-between border-t px-4 py-3 text-xs">
                <span>
                  Exibindo {receivables.items.length} de {receivables.total} títulos
                </span>
                {receivables.items.length < receivables.total && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => loadReceivables(filters, true)}
                    disabled={loading}
                  >
                    Carregar mais
                  </Button>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <ReceivablePaymentDialog
        key={`payment-${dialogKey}`}
        open={paymentDialogOpen}
        onOpenChange={setPaymentDialogOpen}
        receivable={selected}
        hasOpenCashRegister={hasOpenCashRegister}
        onSuccess={handlePaymentSuccess}
      />
    </div>
  );
}
