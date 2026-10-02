import type { CashRegisterSummary } from "@/lib/cash-register";
import { PAYMENT_METHOD_LABELS } from "@/lib/payments";
import { cn, formatCurrency } from "@/lib/utils";

interface CashSummaryProps {
  summary: CashRegisterSummary;
  className?: string;
}

function Row({
  label,
  value,
  muted,
  sign,
}: {
  label: string;
  value: number;
  muted?: boolean;
  sign?: "+" | "−";
}) {
  return (
    <div
      className={cn("flex items-center justify-between text-sm", muted && "text-muted-foreground")}
    >
      <span>{label}</span>
      <span className="font-mono">
        {sign && value > 0 ? `${sign} ` : ""}
        {formatCurrency(value)}
      </span>
    </div>
  );
}

// Resumo do turno: composição do dinheiro esperado e totais por forma (só conferência)
export function CashSummary({ summary, className }: CashSummaryProps) {
  const salesCash = summary.salesByMethod.find((s) => s.method === "MONEY")?.total ?? 0;

  return (
    <div className={cn("grid gap-6 md:grid-cols-2", className)}>
      <div className="space-y-2">
        <h3 className="text-sm font-semibold">Dinheiro na gaveta</h3>
        <Row label="Abertura (suprimento inicial)" value={summary.openingAmount} />
        <Row label="Vendas em dinheiro" value={salesCash} sign="+" />
        <Row label="Suprimentos" value={summary.supplies} sign="+" />
        <Row label="Sangrias" value={summary.withdrawals} sign="−" />
        <Row label="Recebimentos de fiado em dinheiro" value={summary.receivedCash} sign="+" />
        <div className="flex items-center justify-between border-t pt-2 text-base font-semibold">
          <span>Esperado em dinheiro</span>
          <span className="font-mono">{formatCurrency(summary.expectedCash)}</span>
        </div>
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-semibold">
          Vendas do turno{" "}
          <span className="text-muted-foreground font-normal">({summary.salesCount})</span>
        </h3>
        {summary.salesByMethod.length === 0 ? (
          <p className="text-muted-foreground text-sm">Nenhuma venda neste turno.</p>
        ) : (
          summary.salesByMethod.map((s) => (
            <Row
              key={s.method}
              label={`${PAYMENT_METHOD_LABELS[s.method]} (${s.count})`}
              value={s.total}
              muted={s.method !== "MONEY"}
            />
          ))
        )}
        <div className="flex items-center justify-between border-t pt-2 text-sm font-semibold">
          <span>Total vendido</span>
          <span className="font-mono">{formatCurrency(summary.salesTotal)}</span>
        </div>

        {summary.receivedByMethod.length > 0 && (
          <>
            <h3 className="pt-2 text-sm font-semibold">Recebimentos de fiado</h3>
            {summary.receivedByMethod.map((r) => (
              <Row
                key={r.method}
                label={`${PAYMENT_METHOD_LABELS[r.method]} (${r.count})`}
                value={r.total}
                muted={r.method !== "MONEY"}
              />
            ))}
          </>
        )}
      </div>
    </div>
  );
}
