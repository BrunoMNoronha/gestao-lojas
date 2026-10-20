"use server";

import { prisma } from "@/lib/prisma";
import { authorize } from "@/lib/authz";
import { PaymentMethod, Prisma } from "@prisma/client";
import { getReceivablesSummary, type ReceivablesSummary } from "@/actions/receivables";
import type { PaymentMethodValue } from "@/lib/payments";
import {
  DateRange,
  STORE_TIME_ZONE,
  countDays,
  getStorePeriods,
  parseDayKey,
  storeDayRange,
} from "@/lib/store-time";
import {
  MAX_REPORT_DAYS,
  type MethodBreakdown,
  type PeriodTotals,
  type TopProduct,
  salesByMethod,
  salesTotals,
  toNumber,
  topProducts,
} from "@/lib/sales-metrics";

// Faturamento = soma de Sale.total (líquido de desconto) pela data da venda, incluindo vendas
// no Fiado: é a visão de vendas. O dinheiro efetivamente recebido fica no módulo Caixa. Os
// cálculos ficam em src/lib/sales-metrics.ts, compartilhados com os insights (issue #113).

export type { MethodBreakdown, PeriodTotals, TopProduct } from "@/lib/sales-metrics";

export interface DashboardMetrics {
  today: PeriodTotals;
  week: PeriodTotals;
  month: PeriodTotals;
  monthByMethod: MethodBreakdown[];
  topProducts: TopProduct[];
  receivables: ReceivablesSummary;
  lowStockCount: number;
}

export interface SalesReportFilters {
  from: string; // YYYY-MM-DD (dia da loja)
  to: string;
  paymentMethod?: PaymentMethodValue | null;
  userId?: string | null;
  take?: number;
  skip?: number;
}

export interface SalesReportRow {
  id: string;
  code: number;
  occurredAt: string;
  userName: string;
  customerName: string | null;
  paymentMethod: PaymentMethodValue;
  discount: number;
  total: number;
  // Venda estornada: continua na lista, mas fora dos totais
  reversed: boolean;
}

export interface SalesReport {
  totals: PeriodTotals & { discount: number };
  byMethod: MethodBreakdown[];
  daily: { day: string; total: number; count: number }[];
  sales: SalesReportRow[];
  salesTotal: number;
}

const TOP_PRODUCTS_LIMIT = 10;
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

export async function getDashboardMetrics(): Promise<DashboardMetrics | null> {
  try {
    const authz = await authorize("dashboard.view");
    if (!authz.ok) return null;

    const periods = getStorePeriods();
    const inRange = (r: DateRange): Prisma.SaleWhereInput => ({
      occurredAt: { gte: r.from, lte: r.to },
    });

    const [today, week, month, monthByMethod, top, receivables, lowStockCount] = await Promise.all([
      salesTotals(inRange(periods.today)),
      salesTotals(inRange(periods.week)),
      salesTotals(inRange(periods.month)),
      salesByMethod(inRange(periods.month)),
      topProducts(periods.month, TOP_PRODUCTS_LIMIT),
      getReceivablesSummary(),
      // Mesma regra de getLowStockProducts / isStockLow: saldo atual <= estoque mínimo
      prisma.product.count({
        where: { deletedAt: null, currentStock: { lte: prisma.product.fields.minStock } },
      }),
    ]);

    const strip = ({ total, count, averageTicket }: PeriodTotals) => ({
      total,
      count,
      averageTicket,
    });

    return {
      today: strip(today),
      week: strip(week),
      month: strip(month),
      monthByMethod,
      topProducts: top,
      receivables,
      lowStockCount,
    };
  } catch (error) {
    console.error("Erro ao calcular métricas do dashboard:", error);
    return null;
  }
}

export async function getSalesReport(
  filters: SalesReportFilters,
): Promise<{ success: boolean; data?: SalesReport; error?: string }> {
  try {
    const authz = await authorize("reports.view");
    if (!authz.ok) {
      return { success: false, error: authz.error };
    }

    const fromDay = parseDayKey(filters?.from);
    const toDay = parseDayKey(filters?.to);
    if (!fromDay || !toDay) {
      return { success: false, error: "Informe um período válido." };
    }
    const days = countDays(fromDay, toDay);
    if (days < 1) {
      return { success: false, error: "A data inicial não pode ser posterior à data final." };
    }
    if (days > MAX_REPORT_DAYS) {
      return {
        success: false,
        error: `O período máximo do relatório é de ${MAX_REPORT_DAYS} dias.`,
      };
    }

    const method =
      filters.paymentMethod &&
      Object.values(PaymentMethod).includes(filters.paymentMethod as PaymentMethod)
        ? (filters.paymentMethod as PaymentMethod)
        : null;
    if (filters.paymentMethod && !method) {
      return { success: false, error: "Forma de pagamento inválida." };
    }
    const userId = typeof filters.userId === "string" && filters.userId ? filters.userId : null;

    const range = storeDayRange(fromDay, toDay);
    const where: Prisma.SaleWhereInput = {
      occurredAt: { gte: range.from, lte: range.to },
      ...(method ? { paymentMethod: method } : {}),
      ...(userId ? { userId } : {}),
    };

    const conditions = [
      Prisma.sql`s."occurredAt" >= ${range.from}`,
      Prisma.sql`s."occurredAt" <= ${range.to}`,
      Prisma.sql`s."reversedAt" IS NULL`,
    ];
    if (method) conditions.push(Prisma.sql`s."paymentMethod"::text = ${method}`);
    if (userId) conditions.push(Prisma.sql`s."userId" = ${userId}`);

    const take = Math.min(
      Math.max(Math.trunc(filters.take ?? DEFAULT_PAGE_SIZE), 1),
      MAX_PAGE_SIZE,
    );
    const skip = Math.max(Math.trunc(filters.skip ?? 0), 0);

    const [totals, byMethod, daily, sales, listed] = await Promise.all([
      salesTotals(where),
      salesByMethod(where),
      // Agrupa pelo dia no relógio da loja ("occurredAt" é gravado em UTC)
      prisma.$queryRaw<{ day: string; total: Prisma.Decimal; count: bigint }[]>(Prisma.sql`
        SELECT to_char((s."occurredAt" AT TIME ZONE 'UTC') AT TIME ZONE ${STORE_TIME_ZONE}, 'YYYY-MM-DD') AS day,
               SUM(s.total) AS total, COUNT(*) AS count
        FROM "Sale" s
        WHERE ${Prisma.join(conditions, " AND ")}
        GROUP BY 1
        ORDER BY 1
      `),
      prisma.sale.findMany({
        where,
        include: {
          user: { select: { name: true } },
          customer: { select: { name: true } },
        },
        orderBy: [{ occurredAt: "desc" }, { code: "desc" }],
        take,
        skip,
      }),
      // A lista inclui as estornadas (marcadas), então a paginação conta todas
      prisma.sale.count({ where }),
    ]);

    return {
      success: true,
      data: {
        totals,
        byMethod,
        daily: daily.map((d) => ({
          day: d.day,
          total: toNumber(d.total),
          count: toNumber(d.count),
        })),
        sales: sales.map((s) => ({
          id: s.id,
          code: s.code,
          occurredAt: s.occurredAt.toISOString(),
          userName: s.user.name,
          customerName: s.customer?.name ?? null,
          paymentMethod: s.paymentMethod as PaymentMethodValue,
          discount: s.discount.toNumber(),
          total: s.total.toNumber(),
          reversed: s.reversedAt !== null,
        })),
        salesTotal: listed,
      },
    };
  } catch (error) {
    console.error("Erro ao gerar relatório de vendas:", error);
    return { success: false, error: "Falha ao gerar o relatório. Tente novamente." };
  }
}
