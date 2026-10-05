"use client";

import { useState } from "react";
import {
  Wallet,
  ArrowDownToLine,
  ArrowUpFromLine,
  Lock,
  History,
  Loader2,
  X,
  Unlock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MoneyInput } from "@/components/money-input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  CashMovementTypeValue,
  CashOperator,
  CashRegisterHistoryItem,
  CurrentCashRegister,
  getCashRegisterHistory,
  openCashRegister,
} from "@/actions/cash-register";
import { CashSummary } from "@/components/cash-summary";
import { CashMovementDialog } from "@/components/cash-movement-dialog";
import { CashCloseDialog } from "@/components/cash-close-dialog";
import {
  CashRegisterDetailDialog,
  DifferenceValue,
} from "@/components/cash-register-detail-dialog";
import { dayBoundary, formatDateTime } from "@/lib/dates";
import { formatCurrency } from "@/lib/utils";
import { OptionSelect } from "@/components/option-select";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/page-header";

interface CashRegisterManagerProps {
  current: CurrentCashRegister | null;
  operators: CashOperator[];
  initialHistory: { items: CashRegisterHistoryItem[]; total: number };
}

interface HistoryFilters {
  userId: string;
  from: string; // YYYY-MM-DD (dia local)
  to: string;
}

const PAGE_SIZE = 30;
const EMPTY_FILTERS: HistoryFilters = { userId: "", from: "", to: "" };

function OpenCashRegisterCard({ onOpened }: { onOpened: () => void }) {
  const [amount, setAmount] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const value = amount ?? 0;
    if (!Number.isFinite(value) || value < 0) {
      setError("Informe um valor de abertura válido (zero ou mais).");
      return;
    }
    setLoading(true);
    setError(null);
    const res = await openCashRegister({ openingAmount: value });
    setLoading(false);
    if (res.success) {
      onOpened();
    } else {
      setError(res.error || "Erro ao abrir o caixa.");
    }
  };

  return (
    <Card className="max-w-md">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Unlock className="text-primary h-5 w-5" />
          Abrir Caixa
        </CardTitle>
        <CardDescription>
          Você não possui caixa aberto. Informe o suprimento inicial (troco) para começar o turno e
          liberar as vendas no PDV.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-3">
          {error && (
            <div className="text-destructive bg-destructive/10 border-destructive/20 rounded-md border p-2.5 text-xs">
              {error}
            </div>
          )}
          <div className="space-y-1">
            <Label
              htmlFor="cash-register-manager-suprimento-inicial-r"
              className="text-foreground text-xs font-medium"
            >
              Suprimento inicial (R$)
            </Label>
            <MoneyInput
              id="cash-register-manager-suprimento-inicial-r"
              value={amount}
              onValueChange={setAmount}
              autoFocus
            />
          </div>
          <Button type="submit" disabled={loading} className="w-full">
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Abrindo...
              </>
            ) : (
              "Abrir Caixa"
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

export function CashRegisterManager({
  current,
  operators,
  initialHistory,
}: CashRegisterManagerProps) {
  const [view, setView] = useState<"current" | "history">("current");
  const [filters, setFilters] = useState<HistoryFilters>(EMPTY_FILTERS);
  const [history, setHistory] = useState(initialHistory);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // Trocar a key remonta o diálogo e reinicia o formulário a cada abertura
  const [dialogKey, setDialogKey] = useState(0);
  const [movementType, setMovementType] = useState<CashMovementTypeValue>("SUPPLY");
  const [movementDialogOpen, setMovementDialogOpen] = useState(false);
  const [closeDialogOpen, setCloseDialogOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  const hasFilters = Object.values(filters).some(Boolean);

  const loadHistory = async (next: HistoryFilters, append = false) => {
    setLoadingHistory(true);
    const page = await getCashRegisterHistory({
      userId: next.userId || null,
      from: dayBoundary(next.from, false),
      to: dayBoundary(next.to, true),
      take: PAGE_SIZE,
      skip: append ? history.items.length : 0,
    });
    setHistory((prev) =>
      append ? { items: [...prev.items, ...page.items], total: page.total } : page,
    );
    setLoadingHistory(false);
  };

  const updateFilters = (patch: Partial<HistoryFilters>) => {
    const next = { ...filters, ...patch };
    setFilters(next);
    loadHistory(next);
  };

  const openMovementDialog = (type: CashMovementTypeValue) => {
    setDialogKey((k) => k + 1);
    setMovementType(type);
    setMovementDialogOpen(true);
  };

  const openCloseDialog = () => {
    setDialogKey((k) => k + 1);
    setCloseDialogOpen(true);
  };

  const openDetail = (id: string) => {
    setDialogKey((k) => k + 1);
    setDetailId(id);
  };

  const handleClosed = () => {
    loadHistory(filters);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Caixa"
        icon={Wallet}
        description="Abertura, sangrias, suprimentos e fechamento do turno com conferência."
        actions={
          current &&
          view === "current" && (
            <>
              <Button variant="outline" onClick={() => openMovementDialog("SUPPLY")}>
                <ArrowDownToLine />
                Suprimento
              </Button>
              <Button variant="outline" onClick={() => openMovementDialog("WITHDRAWAL")}>
                <ArrowUpFromLine />
                Sangria
              </Button>
              <Button onClick={openCloseDialog}>
                <Lock />
                Fechar Caixa
              </Button>
            </>
          )
        }
      />

      {/* View switch */}
      <div className="bg-muted/40 inline-flex gap-1 rounded-lg border p-1">
        <Button
          size="sm"
          variant={view === "current" ? "default" : "ghost"}
          onClick={() => setView("current")}
          className="gap-1.5"
        >
          <Wallet className="h-4 w-4" />
          Caixa Atual
        </Button>
        <Button
          size="sm"
          variant={view === "history" ? "default" : "ghost"}
          onClick={() => setView("history")}
          className="gap-1.5"
        >
          <History className="h-4 w-4" />
          Histórico de Fechamentos
        </Button>
      </div>

      {view === "current" ? (
        current ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Turno em andamento</CardTitle>
              <CardDescription suppressHydrationWarning>
                Operador {current.userName} · aberto em {formatDateTime(current.openedAt)}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <CashSummary summary={current.summary} />
            </CardContent>
          </Card>
        ) : (
          <OpenCashRegisterCard onOpened={() => {}} />
        )
      ) : (
        <>
          {/* Filters */}
          <Card>
            <CardContent className="grid grid-cols-1 items-end gap-3 p-4 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_auto]">
              <div className="space-y-1">
                <Label
                  htmlFor="cash-register-manager-operador"
                  className="text-muted-foreground text-xs font-medium"
                >
                  Operador
                </Label>
                <OptionSelect
                  id="cash-register-manager-operador"
                  value={filters.userId}
                  onValueChange={(v) => updateFilters({ userId: v })}
                  options={[
                    { value: "", label: "Todos os operadores" },
                    ...operators.map((o) => ({ value: o.id, label: o.name })),
                  ]}
                />
              </div>
              <div className="space-y-1">
                <Label
                  htmlFor="cash-register-manager-fechado-de"
                  className="text-muted-foreground text-xs font-medium"
                >
                  Fechado de
                </Label>
                <Input
                  id="cash-register-manager-fechado-de"
                  type="date"
                  value={filters.from}
                  max={filters.to || undefined}
                  onChange={(e) => updateFilters({ from: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label
                  htmlFor="cash-register-manager-ate"
                  className="text-muted-foreground text-xs font-medium"
                >
                  Até
                </Label>
                <Input
                  id="cash-register-manager-ate"
                  type="date"
                  value={filters.to}
                  min={filters.from || undefined}
                  onChange={(e) => updateFilters({ to: e.target.value })}
                />
              </div>
              <Button
                variant="ghost"
                onClick={() => {
                  setFilters(EMPTY_FILTERS);
                  loadHistory(EMPTY_FILTERS);
                }}
                disabled={!hasFilters}
                className="gap-1"
              >
                <X className="h-4 w-4" />
                Limpar
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-0">
              {history.items.length === 0 ? (
                <div className="flex flex-col items-center justify-center p-12 text-center">
                  {loadingHistory ? (
                    <Loader2 className="text-muted-foreground h-8 w-8 animate-spin" />
                  ) : (
                    <>
                      <History className="text-muted-foreground/50 mb-3 h-12 w-12" />
                      <h3 className="text-base font-semibold">Nenhum fechamento encontrado</h3>
                      <p className="text-muted-foreground mt-1 max-w-sm text-sm">
                        {hasFilters
                          ? "Tente ajustar os filtros."
                          : "Os caixas fechados aparecerão aqui."}
                      </p>
                    </>
                  )}
                </div>
              ) : (
                <>
                  <Table className={loadingHistory ? "opacity-60" : undefined}>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Operador</TableHead>
                        <TableHead>Abertura</TableHead>
                        <TableHead>Fechamento</TableHead>
                        <TableHead className="text-right">Suprimento inicial</TableHead>
                        <TableHead className="text-right">Esperado</TableHead>
                        <TableHead className="text-right">Contado</TableHead>
                        <TableHead className="text-right">Diferença</TableHead>
                        <TableHead className="text-center">Detalhe</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {history.items.map((r) => (
                        <TableRow key={r.id}>
                          <TableCell className="min-w-40 font-medium whitespace-normal">
                            {r.userName}
                          </TableCell>
                          <TableCell
                            className="text-muted-foreground text-xs whitespace-nowrap"
                            suppressHydrationWarning
                          >
                            {formatDateTime(r.openedAt)}
                          </TableCell>
                          <TableCell
                            className="text-muted-foreground text-xs whitespace-nowrap"
                            suppressHydrationWarning
                          >
                            {r.closedAt ? formatDateTime(r.closedAt) : "-"}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {formatCurrency(r.openingAmount)}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {formatCurrency(r.expectedAmount ?? 0)}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {formatCurrency(r.countedAmount ?? 0)}
                          </TableCell>
                          <TableCell className="text-right" title={r.closingNote ?? undefined}>
                            <DifferenceValue value={r.difference ?? 0} />
                          </TableCell>
                          <TableCell className="text-center">
                            <Button size="sm" variant="outline" onClick={() => openDetail(r.id)}>
                              Ver
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>

                  <div className="text-muted-foreground flex items-center justify-between border-t px-4 py-3 text-xs">
                    <span>
                      Exibindo {history.items.length} de {history.total} fechamentos
                    </span>
                    {history.items.length < history.total && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => loadHistory(filters, true)}
                        disabled={loadingHistory}
                      >
                        Carregar mais
                      </Button>
                    )}
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {/* Modals */}
      {current && (
        <>
          <CashMovementDialog
            key={`movement-${dialogKey}`}
            open={movementDialogOpen}
            onOpenChange={setMovementDialogOpen}
            type={movementType}
            expectedCash={current.summary.expectedCash}
            onSuccess={() => {}}
          />
          <CashCloseDialog
            key={`close-${dialogKey}`}
            open={closeDialogOpen}
            cashRegisterId={current.id}
            offlinePending={current.offlinePending}
            onOpenChange={setCloseDialogOpen}
            expectedCash={current.summary.expectedCash}
            onSuccess={handleClosed}
          />
        </>
      )}

      <CashRegisterDetailDialog
        key={`detail-${dialogKey}`}
        open={detailId !== null}
        onOpenChange={(open) => !open && setDetailId(null)}
        cashRegisterId={detailId}
      />
    </div>
  );
}
