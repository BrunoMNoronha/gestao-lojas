import { CashMovementType, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { unpaidReceivables } from "@/lib/on-account";
import { PAYMENT_METHOD_LABELS } from "@/lib/payments";
import {
  notReversed,
  salesByMethod,
  salesTotals,
  toNumber,
  topProducts,
} from "@/lib/sales-metrics";
import {
  type CalendarDay,
  STORE_TIME_ZONE,
  addDays,
  countDays,
  formatDayKey,
  startOfStoreDay,
  storeDayRange,
} from "@/lib/store-time";

// Retrato dos números da loja enviado ao Claude (issue #113), montado só no servidor. Leva apenas
// números agregados e nomes de produtos e categorias: nenhum nome, documento ou telefone de
// cliente, e nenhum dado de operador. As listas têm limite para o prompt ficar pequeno. As chaves
// ficam em português (o modelo lê o JSON) e sempre na mesma ordem (cache do prompt).

const LIST_LIMIT = 20;
const CATEGORY_LIMIT = 10;
// Até este número de dias a série é diária; acima, mensal
const DAILY_SERIES_MAX_DAYS = 62;

const WEEKDAYS = ["segunda", "terça", "quarta", "quinta", "sexta", "sábado", "domingo"];

const round2 = (value: number) => Math.round(value * 100) / 100;
const round1 = (value: number) => Math.round(value * 10) / 10;
const pct = (part: number, whole: number) => (whole > 0 ? round1((part / whole) * 100) : null);
const change = (current: number, previous: number) =>
  previous > 0 ? round1(((current - previous) / previous) * 100) : null;

interface Totals {
  faturamento: number;
  vendas: number;
  ticketMedio: number;
  descontos: number;
}

export interface InsightSnapshot {
  periodo: { de: string; ate: string; dias: number; serie: "diaria" | "mensal" };
  periodoAnterior: { de: string; ate: string };
  vendas: {
    periodo: Totals;
    periodoAnterior: Totals;
    variacaoPct: { faturamento: number | null; vendas: number | null; ticketMedio: number | null };
    estornos: { quantidade: number; valor: number };
  };
  formasPagamento: {
    forma: string;
    faturamento: number;
    vendas: number;
    participacaoPct: number | null;
  }[];
  serie: { periodo: string; faturamento: number; vendas: number }[];
  porDiaDaSemana: { dia: string; faturamento: number; vendas: number }[];
  porHora: { hora: number; faturamento: number; vendas: number }[];
  produtosMaisVendidos: {
    produto: string;
    categoria: string | null;
    unidade: string;
    quantidade: number;
    faturamento: number;
    participacaoPct: number | null;
    margemAtualEstimadaPct: number | null;
    estoqueAtual: number;
  }[];
  categorias: { categoria: string; faturamento: number; participacaoPct: number | null }[];
  produtosSemVendaComEstoque: {
    total: number;
    valorEmEstoqueCusto: number;
    itens: {
      produto: string;
      categoria: string | null;
      unidade: string;
      estoqueAtual: number;
      valorEmEstoqueCusto: number;
    }[];
  };
  estoqueBaixo: {
    total: number;
    itens: { produto: string; unidade: string; estoqueAtual: number; estoqueMinimo: number }[];
  };
  fiado: {
    emAberto: number;
    titulosEmAberto: number;
    clientesDevendo: number;
    vencido: number;
    titulosVencidos: number;
    recebidoNoPeriodo: number;
  };
  caixa: {
    caixasFechados: number;
    caixasComDiferenca: number;
    faltaTotal: number;
    sobraTotal: number;
    sangrias: { quantidade: number; valor: number };
    suprimentos: { quantidade: number; valor: number };
  };
  pedidosCatalogo: {
    recebidos: number;
    convertidosEmVenda: number;
    cancelados: number;
    emAberto: number;
    taxaConversaoPct: number | null;
  };
  clientes: { novosCadastros: number; vendasComClienteIdentificadoPct: number | null };
}

function toTotals(t: Awaited<ReturnType<typeof salesTotals>>): Totals {
  return {
    faturamento: round2(t.total),
    vendas: t.count,
    ticketMedio: round2(t.averageTicket),
    descontos: round2(t.discount),
  };
}

// Dia no relógio da loja ("occurredAt" é gravado em UTC)
const localTime = Prisma.sql`((s."occurredAt" AT TIME ZONE 'UTC') AT TIME ZONE ${STORE_TIME_ZONE})`;

/** Retrato do período [from, to] (dias da loja, inclusivos) e do anterior de mesma duração. */
export async function buildInsightSnapshot(
  from: CalendarDay,
  to: CalendarDay,
  now: Date = new Date(),
): Promise<InsightSnapshot> {
  const days = countDays(from, to);
  const prevTo = addDays(from, -1);
  const prevFrom = addDays(from, -days);
  const range = storeDayRange(from, to);
  const prevRange = storeDayRange(prevFrom, prevTo);
  const inRange = {
    occurredAt: { gte: range.from, lte: range.to },
  } satisfies Prisma.SaleWhereInput;
  const createdIn = { gte: range.from, lte: range.to };
  const monthly = days > DAILY_SERIES_MAX_DAYS;
  const saleInRange = Prisma.sql`s."occurredAt" >= ${range.from} AND s."occurredAt" <= ${range.to}
    AND s."reversedAt" IS NULL`;

  const [
    current,
    previous,
    reversed,
    byMethod,
    seriesRows,
    weekdayRows,
    hourRows,
    top,
    categoryRows,
    idleRows,
    lowRows,
    unpaid,
    debtors,
    overdue,
    received,
    closedRegisters,
    cashMovements,
    catalogOrders,
    newCustomers,
    identifiedSales,
  ] = await Promise.all([
    salesTotals(inRange),
    salesTotals({ occurredAt: { gte: prevRange.from, lte: prevRange.to } }),
    prisma.sale.aggregate({
      where: { ...inRange, reversedAt: { not: null } },
      _sum: { total: true },
      _count: { _all: true },
    }),
    salesByMethod(inRange),
    prisma.$queryRaw<{ period: string; total: Prisma.Decimal; count: bigint }[]>(Prisma.sql`
      SELECT to_char(${localTime}, ${monthly ? "YYYY-MM" : "YYYY-MM-DD"}) AS period,
             SUM(s.total) AS total, COUNT(*) AS count
      FROM "Sale" s WHERE ${saleInRange}
      GROUP BY 1 ORDER BY 1
    `),
    prisma.$queryRaw<{ weekday: number; total: Prisma.Decimal; count: bigint }[]>(Prisma.sql`
      SELECT EXTRACT(ISODOW FROM ${localTime})::int AS weekday,
             SUM(s.total) AS total, COUNT(*) AS count
      FROM "Sale" s WHERE ${saleInRange}
      GROUP BY 1 ORDER BY 1
    `),
    prisma.$queryRaw<{ hour: number; total: Prisma.Decimal; count: bigint }[]>(Prisma.sql`
      SELECT EXTRACT(HOUR FROM ${localTime})::int AS hour,
             SUM(s.total) AS total, COUNT(*) AS count
      FROM "Sale" s WHERE ${saleInRange}
      GROUP BY 1 ORDER BY 1
    `),
    topProducts(range, LIST_LIMIT),
    prisma.$queryRaw<{ category: string | null; revenue: Prisma.Decimal }[]>(Prisma.sql`
      SELECT c.name AS category, SUM(si.subtotal) AS revenue
      FROM "SaleItem" si
      JOIN "Sale" s ON s.id = si."saleId"
      JOIN "Product" p ON p.id = si."productId"
      LEFT JOIN "Category" c ON c.id = p."categoryId"
      WHERE ${saleInRange}
      GROUP BY c.name
      ORDER BY revenue DESC
      LIMIT ${CATEGORY_LIMIT}
    `),
    // Produtos ativos com saldo e nenhuma venda no período, do maior valor parado (a custo) ao menor
    prisma.$queryRaw<
      {
        name: string;
        category: string | null;
        unit: string;
        stock: Prisma.Decimal;
        value: Prisma.Decimal;
        total: bigint;
        totalValue: Prisma.Decimal;
      }[]
    >(Prisma.sql`
      SELECT p.name, c.name AS category, p.unit::text AS unit, p."currentStock" AS stock,
             p."currentStock" * p."costPrice" AS value,
             COUNT(*) OVER () AS total, SUM(p."currentStock" * p."costPrice") OVER () AS "totalValue"
      FROM "Product" p
      LEFT JOIN "Category" c ON c.id = p."categoryId"
      WHERE p."deletedAt" IS NULL AND p."currentStock" > 0
        AND NOT EXISTS (
          SELECT 1 FROM "SaleItem" si JOIN "Sale" s ON s.id = si."saleId"
          WHERE si."productId" = p.id AND ${saleInRange}
        )
      ORDER BY value DESC, p.name ASC
      LIMIT ${LIST_LIMIT}
    `),
    // Mesma regra do Dashboard: saldo atual <= estoque mínimo
    prisma.$queryRaw<
      { name: string; unit: string; stock: Prisma.Decimal; min: Prisma.Decimal; total: bigint }[]
    >(Prisma.sql`
      SELECT p.name, p.unit::text AS unit, p."currentStock" AS stock, p."minStock" AS min,
             COUNT(*) OVER () AS total
      FROM "Product" p
      WHERE p."deletedAt" IS NULL AND p."currentStock" <= p."minStock"
      ORDER BY p."currentStock" - p."minStock" ASC, p.name ASC
      LIMIT ${LIST_LIMIT}
    `),
    prisma.receivable.aggregate({
      where: unpaidReceivables,
      _sum: { amount: true, paidAmount: true },
      _count: { _all: true },
    }),
    prisma.receivable.groupBy({ by: ["customerId"], where: unpaidReceivables }),
    prisma.receivable.aggregate({
      where: { ...unpaidReceivables, dueDate: { lt: startOfStoreDay(now) } },
      _sum: { amount: true, paidAmount: true },
      _count: { _all: true },
    }),
    prisma.receivablePayment.aggregate({ where: { createdAt: createdIn }, _sum: { amount: true } }),
    prisma.cashRegister.findMany({
      where: { closedAt: createdIn },
      select: { difference: true },
    }),
    // Sangria ligada a uma venda é devolução de estorno, não retirada do caixa
    prisma.cashMovement.groupBy({
      by: ["type"],
      where: { createdAt: createdIn, saleId: null },
      _sum: { amount: true },
      _count: { _all: true },
    }),
    prisma.catalogOrder.groupBy({
      by: ["status"],
      where: { createdAt: createdIn },
      _count: { _all: true },
    }),
    prisma.customer.count({ where: { createdAt: createdIn, deletedAt: null } }),
    prisma.sale.count({ where: { ...inRange, ...notReversed, customerId: { not: null } } }),
  ]);

  const periodTotals = toTotals(current);
  const previousTotals = toTotals(previous);
  const revenue = periodTotals.faturamento;

  // Série completa, com zero nos dias (ou meses) sem venda
  const byPeriod = new Map(seriesRows.map((r) => [r.period, r]));
  const periods: string[] = [];
  if (monthly) {
    for (let d = { ...from, day: 1 }; formatDayKey(d) <= formatDayKey(to);) {
      periods.push(formatDayKey(d).slice(0, 7));
      d = d.month === 12 ? { year: d.year + 1, month: 1, day: 1 } : { ...d, month: d.month + 1 };
    }
  } else {
    for (let i = 0; i < days; i++) periods.push(formatDayKey(addDays(from, i)));
  }

  const productDetails = await prisma.product.findMany({
    where: { id: { in: top.map((t) => t.productId) } },
    select: {
      id: true,
      salePrice: true,
      costPrice: true,
      currentStock: true,
      category: { select: { name: true } },
    },
  });
  const details = new Map(productDetails.map((p) => [p.id, p]));

  const movement = (type: CashMovementType) => {
    const group = cashMovements.find((m) => m.type === type);
    return { quantidade: group?._count._all ?? 0, valor: round2(toNumber(group?._sum.amount)) };
  };
  const orders = (status: string) =>
    catalogOrders.find((o) => o.status === status)?._count._all ?? 0;
  const ordersTotal = catalogOrders.reduce((sum, o) => sum + o._count._all, 0);
  const differences = closedRegisters.map((r) => toNumber(r.difference));
  const unpaidAmount = (agg: typeof unpaid) =>
    round2(toNumber(agg._sum.amount) - toNumber(agg._sum.paidAmount));

  return {
    periodo: {
      de: formatDayKey(from),
      ate: formatDayKey(to),
      dias: days,
      serie: monthly ? "mensal" : "diaria",
    },
    periodoAnterior: { de: formatDayKey(prevFrom), ate: formatDayKey(prevTo) },
    vendas: {
      periodo: periodTotals,
      periodoAnterior: previousTotals,
      variacaoPct: {
        faturamento: change(periodTotals.faturamento, previousTotals.faturamento),
        vendas: change(periodTotals.vendas, previousTotals.vendas),
        ticketMedio: change(periodTotals.ticketMedio, previousTotals.ticketMedio),
      },
      estornos: {
        quantidade: reversed._count._all,
        valor: round2(toNumber(reversed._sum.total)),
      },
    },
    formasPagamento: byMethod.map((m) => ({
      forma: PAYMENT_METHOD_LABELS[m.method],
      faturamento: round2(m.total),
      vendas: m.count,
      participacaoPct: pct(m.total, revenue),
    })),
    serie: periods.map((period) => {
      const row = byPeriod.get(period);
      return {
        periodo: period,
        faturamento: round2(toNumber(row?.total)),
        vendas: toNumber(row?.count),
      };
    }),
    porDiaDaSemana: weekdayRows.map((r) => ({
      dia: WEEKDAYS[r.weekday - 1],
      faturamento: round2(toNumber(r.total)),
      vendas: toNumber(r.count),
    })),
    porHora: hourRows.map((r) => ({
      hora: r.hour,
      faturamento: round2(toNumber(r.total)),
      vendas: toNumber(r.count),
    })),
    produtosMaisVendidos: top.map((t) => {
      const product = details.get(t.productId);
      const sale = toNumber(product?.salePrice);
      const cost = toNumber(product?.costPrice);
      return {
        produto: t.name,
        categoria: product?.category?.name ?? null,
        unidade: t.unit,
        quantidade: t.quantity,
        faturamento: round2(t.revenue),
        participacaoPct: pct(t.revenue, revenue),
        margemAtualEstimadaPct: sale > 0 && cost > 0 ? round1(((sale - cost) / sale) * 100) : null,
        estoqueAtual: toNumber(product?.currentStock),
      };
    }),
    categorias: categoryRows.map((c) => ({
      categoria: c.category ?? "Sem categoria",
      faturamento: round2(toNumber(c.revenue)),
      participacaoPct: pct(toNumber(c.revenue), revenue),
    })),
    produtosSemVendaComEstoque: {
      total: toNumber(idleRows[0]?.total),
      valorEmEstoqueCusto: round2(toNumber(idleRows[0]?.totalValue)),
      itens: idleRows.map((p) => ({
        produto: p.name,
        categoria: p.category,
        unidade: p.unit,
        estoqueAtual: toNumber(p.stock),
        valorEmEstoqueCusto: round2(toNumber(p.value)),
      })),
    },
    estoqueBaixo: {
      total: toNumber(lowRows[0]?.total),
      itens: lowRows.map((p) => ({
        produto: p.name,
        unidade: p.unit,
        estoqueAtual: toNumber(p.stock),
        estoqueMinimo: toNumber(p.min),
      })),
    },
    fiado: {
      emAberto: unpaidAmount(unpaid),
      titulosEmAberto: unpaid._count._all,
      clientesDevendo: debtors.length,
      vencido: unpaidAmount(overdue),
      titulosVencidos: overdue._count._all,
      recebidoNoPeriodo: round2(toNumber(received._sum.amount)),
    },
    caixa: {
      caixasFechados: closedRegisters.length,
      caixasComDiferenca: differences.filter((d) => d !== 0).length,
      faltaTotal: round2(-differences.filter((d) => d < 0).reduce((a, b) => a + b, 0)),
      sobraTotal: round2(differences.filter((d) => d > 0).reduce((a, b) => a + b, 0)),
      sangrias: movement(CashMovementType.WITHDRAWAL),
      suprimentos: movement(CashMovementType.SUPPLY),
    },
    pedidosCatalogo: {
      recebidos: ordersTotal,
      convertidosEmVenda: orders("CONVERTED"),
      cancelados: orders("CANCELED"),
      emAberto: orders("OPEN"),
      taxaConversaoPct: pct(orders("CONVERTED"), ordersTotal),
    },
    clientes: {
      novosCadastros: newCustomers,
      vendasComClienteIdentificadoPct: pct(identifiedSales, periodTotals.vendas),
    },
  };
}
