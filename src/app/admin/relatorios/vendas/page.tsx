import { getSalesReport } from "@/actions/reports";
import { getCashOperators } from "@/actions/cash-register";
import { connection } from "next/server";
import { currentMonthDayKeys } from "@/lib/store-time";
import { SalesReportView } from "@/components/sales-report-view";
import { requirePageAccess } from "@/lib/authz";

export const metadata = {
  title: "Relatório de Vendas",
};

export default async function RelatorioVendasPage() {
  // Período padrão depende da data atual e as vendas mudam a cada minuto
  await connection();
  await requirePageAccess("reports.view");

  const initialFilters = currentMonthDayKeys();
  const [operators, report] = await Promise.all([
    getCashOperators(),
    getSalesReport({ ...initialFilters, take: 50 }),
  ]);

  if (!report.success || !report.data) {
    return (
      <div className="flex h-[calc(100vh-4rem)] items-center justify-center">
        <div className="bg-card max-w-md rounded-lg border p-6 text-center">
          <h2 className="text-lg font-semibold">Relatório indisponível</h2>
          <p className="text-muted-foreground mt-2 text-sm">
            {report.error ??
              "Não foi possível gerar o relatório. Verifique a conexão com o banco de dados."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <SalesReportView
      operators={operators}
      initialFilters={initialFilters}
      initialReport={report.data}
    />
  );
}
