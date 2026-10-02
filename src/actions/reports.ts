"use server";

import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { PaymentMethod, Prisma } from "@prisma/client";
import { getReceivablesSummary, type ReceivablesSummary } from "@/actions/receivables";
import type { PaymentMethodValue } from "@/lib/payments";
import type { UnitType } from "@/actions/products";
import {
  DateRange,
  STORE_TIME_ZONE,
  countDays,
  getStorePeriods,
  parseDayKey,
  storeDayRange,
} from "@/lib/store-time";

// Faturamento = soma de Sale.total (líquido de desconto) pela data da venda, incluindo vendas
// no Fiado: é a visão de vendas. O dinheiro efetivamente recebido fica no módulo Caixa.

export interface PeriodTotals {
  total: number;
  count: number;
  averageTicket: number;
}

export interface MethodBreakdown {
  method: PaymentMethodValue;
  total: number;
  count: number;
}

export interface TopProduct {
  productId: string;
  name: string;
  unit: UnitType;
  quantity: number;
  revenue: number;
}

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
  createdAt: string;
  userName: string;
  customerName: string | null;
  paymentMethod: PaymentMethodValue;
  discount: number;
  total: number;
}

export interface SalesReport {
  totals: PeriodTotals & { discount: number };
  byMethod: MethodBreakdown[];
  daily: { day: string; total: number; count: number }[];
  sales: SalesReportRow[];
  salesTotal: number;
}

const MAX_REPORT_DAYS = 366;
const TOP_PRODUCTS_LIMIT = 10;
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

const toNumber = (value: Prisma.Decimal | number | bigint | null | undefined) =>
  value === null || value === undefined ? 0 : Number(value.toString());

function periodTotals(total: Prisma.Decimal | null, count: number): PeriodTotals {
  const sum = total ?? new Prisma.Decimal(0);
  return {
    total: sum.toNumber(),
    count,
    averageTicket: count > 0 ? sum.div(count).toDecimalPlaces(2).toNumber() : 0,
  };
}

async function salesTotals(where: Prisma.SaleWhereInput) {
  const result = await prisma.sale.aggregate({
    where,
    _sum: { total: true, discount: true },
    _count: { _all: true },
  });
  return {
    ...periodTotals(result._sum.total, result._count._all),
    discount: toNumber(result._sum.discount),
  };
}

async function salesByMethod(where: Prisma.SaleWhereInput): Promise<MethodBreakdown[]> {
  const groups = await prisma.sale.groupBy({
    by: ["paymentMethod"],
    where,
    _sum: { total: true },
    _count: { _all: true },
  });
  return groups
    .map((g) => ({
      method: g.paymentMethod as PaymentMethodValue,
      total: toNumber(g._sum.total),
      count: g._count._all,
    }))
    .sort((a, b) => b.total - a.total);
}

async function topProducts(range: DateRange): Promise<TopProduct[]> {
  const rows = await prisma.$queryRaw<
    {
      productId: string;
      name: string;
      unit: string;
      quantity: Prisma.Decimal;
      revenue: Prisma.Decimal;
    }[]
  >(Prisma.sql`
    SELECT si."productId" AS "productId", p.name AS name, p.unit::text AS unit,
           SUM(si.quantity) AS quantity, SUM(si.subtotal) AS revenue
    FROM "SaleItem" si
    JOIN "Sale" s ON s.id = si."saleId"
    JOIN "Product" p ON p.id = si."productId"
    WHERE s."createdAt" >= ${range.from} AND s."createdAt" <= ${range.to}
    GROUP BY si."productId", p.name, p.unit
    ORDER BY revenue DESC, p.name ASC
    LIMIT ${TOP_PRODUCTS_LIMIT}
  `);
  return rows.map((r) => ({
    productId: r.productId,
    name: r.name,
    unit: r.unit as UnitType,
    quantity: toNumber(r.quantity),
    revenue: toNumber(r.revenue),
  }));
}

export async function getDashboardMetrics(): Promise<DashboardMetrics | null> {
  try {
    const session = await auth();
    if (!session?.user?.id) return null;

    const periods = getStorePeriods();
    const inRange = (r: DateRange): Prisma.SaleWhereInput => ({
      createdAt: { gte: r.from, lte: r.to },
    });

    const [today, week, month, monthByMethod, top, receivables, lowStockCount] = await Promise.all([
      salesTotals(inRange(periods.today)),
      salesTotals(inRange(periods.week)),
      salesTotals(inRange(periods.month)),
      salesByMethod(inRange(periods.month)),
      topProducts(periods.month),
      getReceivablesSummary(),
      // Mesma regra de getLowStockProducts / isStockLow: saldo atual <= estoque mínimo
      prisma.product.count({
        where: { currentStock: { lte: prisma.product.fields.minStock } },
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
    const session = await auth();
    if (!session?.user?.id) {
      return { success: false, error: "Sessão expirada. Faça login novamente." };
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
      createdAt: { gte: range.from, lte: range.to },
      ...(method ? { paymentMethod: method } : {}),
      ...(userId ? { userId } : {}),
    };

    const conditions = [
      Prisma.sql`s."createdAt" >= ${range.from}`,
      Prisma.sql`s."createdAt" <= ${range.to}`,
    ];
    if (method) conditions.push(Prisma.sql`s."paymentMethod"::text = ${method}`);
    if (userId) conditions.push(Prisma.sql`s."userId" = ${userId}`);

    const take = Math.min(
      Math.max(Math.trunc(filters.take ?? DEFAULT_PAGE_SIZE), 1),
      MAX_PAGE_SIZE,
    );
    const skip = Math.max(Math.trunc(filters.skip ?? 0), 0);

    const [totals, byMethod, daily, sales] = await Promise.all([
      salesTotals(where),
      salesByMethod(where),
      // Agrupa pelo dia no relógio da loja ("createdAt" é gravado em UTC)
      prisma.$queryRaw<{ day: string; total: Prisma.Decimal; count: bigint }[]>(Prisma.sql`
        SELECT to_char((s."createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${STORE_TIME_ZONE}, 'YYYY-MM-DD') AS day,
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
        orderBy: [{ createdAt: "desc" }, { code: "desc" }],
        take,
        skip,
      }),
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
          createdAt: s.createdAt.toISOString(),
          userName: s.user.name,
          customerName: s.customer?.name ?? null,
          paymentMethod: s.paymentMethod as PaymentMethodValue,
          discount: s.discount.toNumber(),
          total: s.total.toNumber(),
        })),
        salesTotal: totals.count,
      },
    };
  } catch (error) {
    console.error("Erro ao gerar relatório de vendas:", error);
    return { success: false, error: "Falha ao gerar o relatório. Tente novamente." };
  }
}
