import { randomUUID } from "node:crypto";
import { PaymentMethod, Prisma, Role, Unit } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { CreateSaleInput } from "@/lib/create-sale";

// Dados fictícios para os testes de integração. Cada teste começa com o banco vazio.

/** Apaga todas as tabelas da aplicação (mantém o histórico de migrations). */
export async function resetDatabase() {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  `;
  const list = tables.map((t) => `"${t.tablename}"`).join(", ");
  await prisma.$executeRawUnsafe(`TRUNCATE ${list} RESTART IDENTITY CASCADE`);
}

export async function createUser(name = "Operador Teste") {
  return prisma.user.create({
    data: {
      name,
      email: `${randomUUID()}@teste.local`,
      password: "hash-ficticio",
      role: Role.SELLER,
    },
  });
}

export async function openCashRegister(userId: string) {
  return prisma.cashRegister.create({
    data: { userId, openUserId: userId, openingAmount: new Prisma.Decimal(100) },
  });
}

/** Loja mínima: operador com caixa aberto, dois produtos e um cliente. */
export async function seedStore() {
  const user = await createUser();
  const cashRegister = await openCashRegister(user.id);
  const rice = await prisma.product.create({
    data: {
      name: "Arroz 5kg",
      costPrice: new Prisma.Decimal(6),
      salePrice: new Prisma.Decimal(10),
      unit: Unit.UN,
      currentStock: new Prisma.Decimal(10),
    },
  });
  const cheese = await prisma.product.create({
    data: {
      name: "Queijo minas",
      costPrice: new Prisma.Decimal(30),
      salePrice: new Prisma.Decimal("45.90"),
      unit: Unit.KG,
      currentStock: new Prisma.Decimal("2.5"),
    },
  });
  const customer = await prisma.customer.create({ data: { name: "Cliente Teste" } });
  return { user, cashRegister, rice, cheese, customer };
}

export type Store = Awaited<ReturnType<typeof seedStore>>;

/** Venda em dinheiro de 2 arroz + 0,5 kg de queijo (total 42,95), com chave nova. */
export function saleInput(store: Store, overrides: Partial<CreateSaleInput> = {}): CreateSaleInput {
  return {
    operationId: randomUUID(),
    cashRegisterId: store.cashRegister.id,
    customerId: null,
    paymentMethod: PaymentMethod.MONEY,
    discount: 0,
    amountPaid: 50,
    items: [
      { productId: store.rice.id, quantity: 2 },
      { productId: store.cheese.id, quantity: 0.5 },
    ],
    ...overrides,
  };
}

/** Quantidade de registros afetados por uma venda. */
export async function effectCounts() {
  const [sales, items, movements, receivables, operations] = await Promise.all([
    prisma.sale.count(),
    prisma.saleItem.count(),
    prisma.stockMovement.count(),
    prisma.receivable.count(),
    prisma.syncOperation.count(),
  ]);
  return { sales, items, movements, receivables, operations };
}

export async function stockOf(productId: string) {
  const product = await prisma.product.findUniqueOrThrow({ where: { id: productId } });
  return product.currentStock.toString();
}

/** Aparelho registrado e autorização offline de 12 horas para o operador e o caixa (#37). */
export async function prepareOffline(
  userId: string,
  cashRegisterId: string,
  issuedAt: Date = new Date(),
) {
  const device = await prisma.offlineDevice.create({
    data: { name: "Chrome · Windows", registeredById: userId, lastSyncAt: issuedAt },
  });
  const grant = await prisma.offlineGrant.create({
    data: {
      deviceId: device.id,
      userId,
      cashRegisterId,
      issuedAt,
      expiresAt: new Date(issuedAt.getTime() + 12 * 60 * 60 * 1000),
    },
  });
  return { device, grant };
}

export type OfflineContext = {
  userId: string;
  deviceId: string;
  grantId: string;
  cashRegisterId: string;
};

/**
 * Venda offline no formato do protocolo v1 (decimais como texto): 2 arroz a 10,00 + 0,5 kg de
 * queijo a 45,90 (total 42,95) em dinheiro, com chave nova.
 */
export function offlineSale(
  store: Store,
  ctx: OfflineContext,
  overrides: Record<string, unknown> = {},
  payload: Record<string, unknown> = {},
) {
  return {
    protocolVersion: 1,
    kind: "sale.create",
    operationId: randomUUID(),
    occurredAt: new Date().toISOString(),
    ...ctx,
    ...overrides,
    payload: {
      customerId: null,
      paymentMethod: PaymentMethod.MONEY,
      discount: "0.00",
      amountPaid: "50.00",
      items: [
        { productId: store.rice.id, quantity: "2", unitPrice: "10.00" },
        { productId: store.cheese.id, quantity: "0.5", unitPrice: "45.90" },
      ],
      ...payload,
    },
  };
}

/** Efeitos de uma venda mais as pendências de conciliação. */
export async function offlineEffectCounts() {
  return { ...(await effectCounts()), issues: await prisma.reconciliationIssue.count() };
}
