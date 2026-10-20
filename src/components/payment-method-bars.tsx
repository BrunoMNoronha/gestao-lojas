import type { MethodBreakdown } from "@/actions/reports";
import { PAYMENT_METHOD_LABELS } from "@/lib/payments";
import { formatCurrency } from "@/lib/utils";

interface PaymentMethodBarsProps {
  data: MethodBreakdown[];
  emptyMessage?: string;
}

// Barras horizontais em CSS: cada linha traz rótulo, valor, percentual e quantidade em texto,
// então a informação não depende da cor nem do tamanho da barra.
export function PaymentMethodBars({
  data,
  emptyMessage = "Nenhuma venda no período.",
}: PaymentMethodBarsProps) {
  const total = data.reduce((sum, d) => sum + d.total, 0);
  const max = Math.max(...data.map((d) => d.total), 0);

  if (data.length === 0 || total <= 0) {
    return <p className="text-muted-foreground py-6 text-center text-sm">{emptyMessage}</p>;
  }

  return (
    <ul className="space-y-3">
      {data.map((d) => {
        const percent = (d.total / total) * 100;
        const width = max > 0 ? Math.max((d.total / max) * 100, 2) : 0;
        return (
          <li key={d.method} className="space-y-1">
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="font-medium">{PAYMENT_METHOD_LABELS[d.method]}</span>
              <span className="text-muted-foreground text-xs">
                <span className="text-foreground font-mono text-sm font-semibold">
                  {formatCurrency(d.total)}
                </span>{" "}
                · {percent.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% · {d.count}{" "}
                {d.count === 1 ? "venda" : "vendas"}
              </span>
            </div>
            <div className="bg-muted h-2.5 w-full overflow-hidden rounded-full" aria-hidden="true">
              <div className="bg-primary h-full rounded-full" style={{ width: `${width}%` }} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
