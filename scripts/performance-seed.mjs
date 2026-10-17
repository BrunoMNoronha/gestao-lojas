// Somente banco descartável local. Não apaga dados: exige banco vazio.
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const url = new URL(process.env.TEST_DATABASE_URL ?? "");
if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || !url.pathname.includes("test")) {
  throw new Error("Use TEST_DATABASE_URL de um banco local descartável com test no nome.");
}
const db = new PrismaClient({ datasources: { db: { url: url.href } } });
try {
  if ((await db.user.count()) || (await db.product.count()) || (await db.sale.count()))
    throw new Error("Banco deve estar vazio.");
  await db.user.create({
    data: {
      id: "perf-user",
      name: "Operador de teste",
      email: "perf@teste.local",
      password: await bcrypt.hash("senha-de-teste-123", 10),
      role: "ADMIN",
    },
  });
  await db.cashRegister.create({
    data: { id: "perf-cash", userId: "perf-user", openUserId: "perf-user", openingAmount: 100 },
  });
  await db.storeSettings.create({
    data: {
      id: "default",
      companyName: "Loja de teste",
      tradeName: "Loja de teste",
      catalogEnabled: true,
      whatsappNumber: "5511999999999",
    },
  });
  await db.$executeRawUnsafe(
    `INSERT INTO "Product" (id,name,sku,"costPrice","salePrice",unit,"currentStock","minStock","showInCatalog",description,"updatedAt") SELECT 'perf-product-'||i, 'Produto '||lpad(i::text,5,'0'), 'P'||i, 6, 10, 'UN', 100, 5, true, repeat('Descrição de teste. ',20), now() FROM generate_series(1,10000) i`,
  );
  await db.$executeRawUnsafe(
    `INSERT INTO "Customer" (id,name,document,"updatedAt") SELECT 'perf-customer-'||i, 'Cliente '||lpad(i::text,5,'0'), lpad(i::text,11,'0'), now() FROM generate_series(1,50000) i`,
  );
  await db.$executeRawUnsafe(
    `INSERT INTO "Sale" (id,total,"paymentMethod","userId","customerId","cashRegisterId","occurredAt") SELECT 'perf-sale-'||i,10,'PIX','perf-user','perf-customer-'||(1+(i%50000)),'perf-cash',now() - (i%90)*interval '1 day' FROM generate_series(1,100000) i`,
  );
  await db.$executeRawUnsafe(
    `INSERT INTO "SaleItem" (id,"saleId","productId",quantity,"unitPrice",subtotal) SELECT 'perf-item-'||i,'perf-sale-'||i,'perf-product-'||(1+(i%10000)),1,10,10 FROM generate_series(1,100000) i`,
  );
  await db.$executeRawUnsafe("ANALYZE");
  console.log("Volume de teste: 10.000 produtos, 50.000 clientes e 100.000 vendas.");
} finally {
  await db.$disconnect();
}
