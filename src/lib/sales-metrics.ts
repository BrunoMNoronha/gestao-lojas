import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { PaymentMethodValue } from "@/lib/payments";
import type { UnitType } from "@/actions/products";
import type { DateRange } from "@/lib/store-time";

// Cálculos de vendas usados pelo Dashboard, pelo relatório de vendas e pelos insights (issue
// #113). Faturamento = soma de Sale.total (líquido de desconto) pela data da venda, incluindo o
// Fiado; vendas estornadas ficam fora de todos os totais (src/lib/reverse-sale.ts). Sem
// autorização aqui: quem chama é uma Server Action que já autorizou.

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

/** Período máximo dos relatórios e das análises, em dias. */
export const MAX_REPORT_DAYS = 366;

export const toNumber = (value: Prisma.Decimal | number | bigint | null | undefined) =>
  value === null || value === undefined ? 0 : Number(value.toString());

function periodTotals(total: Prisma.Decimal | null, count: number): PeriodTotals {
  const sum = total ?? new Prisma.Decimal(0);
  return {
    total: sum.toNumber(),
    count,
    averageTicket: count > 0 ? sum.div(count).toDecimalPlaces(2).toNumber() : 0,
  };
}

export const notReversed = { reversedAt: null } satisfies Prisma.SaleWhereInput;

export async function salesTotals(where: Prisma.SaleWhereInput) {
  const result = await prisma.sale.aggregate({
    where: { ...where, ...notReversed },
    _sum: { total: true, discount: true },
    _count: { _all: true },
  });
  return {
    ...periodTotals(result._sum.total, result._count._all),
    discount: toNumber(result._sum.discount),
  };
}

export async function salesByMethod(where: Prisma.SaleWhereInput): Promise<MethodBreakdown[]> {
  const groups = await prisma.sale.groupBy({
    by: ["paymentMethod"],
    where: { ...where, ...notReversed },
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

export async function topProducts(range: DateRange, limit: number): Promise<TopProduct[]> {
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
    WHERE s."occurredAt" >= ${range.from} AND s."occurredAt" <= ${range.to}
      AND s."reversedAt" IS NULL
    GROUP BY si."productId", p.name, p.unit
    ORDER BY revenue DESC, p.name ASC
    LIMIT ${limit}
  `);
  return rows.map((r) => ({
    productId: r.productId,
    name: r.name,
    unit: r.unit as UnitType,
    quantity: toNumber(r.quantity),
    revenue: toNumber(r.revenue),
  }));
}
