import { PrismaClient, Prisma, Role, Unit } from "@prisma/client";
import bcrypt from "bcryptjs";
import { testDatabaseUrl } from "../../integration/test-database";

// Banco dos testes de navegador: o mesmo PostgreSQL local e descartável dos testes de
// integração. Cada cenário começa do zero, com uma loja mínima de dados fictícios.

export const db = new PrismaClient({ datasources: { db: { url: testDatabaseUrl() } } });

export const PASSWORD = "senha-de-teste-123";

/** Apaga todas as tabelas da aplicação (mantém o histórico de migrations). */
export async function resetDatabase() {
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  `;
  const list = tables.map((t) => `"${t.tablename}"`).join(", ");
  await db.$executeRawUnsafe(`TRUNCATE ${list} RESTART IDENTITY CASCADE`);
}

let passwordHash: string | null = null;

async function createUser(name: string, email: string, role: Role) {
  passwordHash ??= await bcrypt.hash(PASSWORD, 10);
  return db.user.create({ data: { name, email, password: passwordHash, role } });
}

/**
 * Loja mínima: vendedor com caixa aberto (R$ 100,00), outro vendedor, gerente, dois produtos e um
 * cliente. Arroz por unidade (R$ 10,00, saldo 10) e queijo por quilo (R$ 45,90, saldo 5).
 */
export async function seedStore() {
  const seller = await createUser("Vendedora Ana", "ana@teste.local", Role.SELLER);
  const otherSeller = await createUser("Vendedor Beto", "beto@teste.local", Role.SELLER);
  const manager = await createUser("Gerente Carla", "carla@teste.local", Role.MANAGER);
  const cashRegister = await db.cashRegister.create({
    data: {
      userId: seller.id,
      openUserId: seller.id,
      openingAmount: new Prisma.Decimal(100),
    },
  });
  const rice = await db.product.create({
    data: {
      name: "Arroz 5kg",
      sku: "ARZ",
      barcode: "7891234567895",
      costPrice: new Prisma.Decimal(6),
      salePrice: new Prisma.Decimal(10),
      unit: Unit.UN,
      currentStock: new Prisma.Decimal(10),
    },
  });
  const cheese = await db.product.create({
    data: {
      name: "Queijo minas",
      sku: "QJO",
      costPrice: new Prisma.Decimal(30),
      salePrice: new Prisma.Decimal("45.90"),
      unit: Unit.KG,
      currentStock: new Prisma.Decimal(5),
    },
  });
  const customer = await db.customer.create({ data: { name: "Cliente Teste" } });
  return { seller, otherSeller, manager, cashRegister, rice, cheese, customer };
}

export type Store = Awaited<ReturnType<typeof seedStore>>;

export async function stockOf(productId: string): Promise<string> {
  const product = await db.product.findUniqueOrThrow({ where: { id: productId } });
  return product.currentStock.toFixed(3);
}

/** Retrato do que uma venda afeta: vendas, itens, estoque, caixa, recebíveis e conciliação. */
export async function snapshot(store: Store) {
  const [sales, items, movements, receivables, operations, issues, rice, cheese, cashSales] =
    await Promise.all([
      db.sale.count(),
      db.saleItem.count(),
      db.stockMovement.count(),
      db.receivable.count(),
      db.syncOperation.count(),
      db.reconciliationIssue.count(),
      stockOf(store.rice.id),
      stockOf(store.cheese.id),
      db.sale.aggregate({
        where: { cashRegisterId: store.cashRegister.id },
        _sum: { total: true },
      }),
    ]);
  return {
    sales,
    items,
    movements,
    receivables,
    operations,
    issues,
    rice,
    cheese,
    cashSalesTotal: (cashSales._sum.total ?? new Prisma.Decimal(0)).toFixed(2),
  };
}
