import { randomUUID } from "node:crypto";
import { CashMovementType, PaymentMethod, Prisma, Role, Unit } from "@prisma/client";
import bcrypt from "bcryptjs";
import { db, PASSWORD, resetDatabase } from "../../e2e/support/db";
import { SCAN_BARCODE } from "./scan";

// Loja de demonstração das capturas e do vídeo da landing page (pnpm screenshots): cadastros,
// 30 dias de vendas, caixa aberto, fiado e pedidos do catálogo, com dados fictícios.

export const ADMIN_EMAIL = "marina@demo.local";
export const MANAGER_EMAIL = "rafael@demo.local";
export const SELLER_EMAIL = "ana@demo.local";

const money = (value: number | string) => new Prisma.Decimal(value);
const qty = (value: number | string) => new Prisma.Decimal(value);
const daysAgo = (days: number, hour: number, minute = 0) => {
  const date = new Date();
  date.setDate(date.getDate() - days);
  date.setHours(hour, minute, 0, 0);
  return date;
};

// Gerador determinístico: as capturas saem iguais a cada execução
let seed = 42;
const random = () => {
  seed = (seed * 16807) % 2147483647;
  return (seed - 1) / 2147483646;
};
const pick = <T>(list: readonly T[]) => list[Math.floor(random() * list.length)];

interface ProductSeed {
  name: string;
  sku: string;
  barcode?: string;
  category: string;
  cost: number;
  price: number;
  unit?: Unit;
  stock: number;
  minStock?: number;
  catalog?: boolean;
  description?: string;
}

const CATEGORIES = [
  "Mercearia",
  "Bebidas",
  "Hortifrúti",
  "Ração e Pet",
  "Agro e Jardim",
  "Limpeza",
];

const PRODUCTS: ProductSeed[] = [
  {
    name: "Arroz tipo 1 5 kg",
    sku: "ARZ-5",
    barcode: "7891000100103",
    category: "Mercearia",
    cost: 19.9,
    price: 27.9,
    stock: 48,
    minStock: 10,
    catalog: true,
    description: "Arroz branco tipo 1, grãos longos e soltinhos.",
  },
  {
    name: "Feijão carioca 1 kg",
    sku: "FEJ-1",
    barcode: "7891000100202",
    category: "Mercearia",
    cost: 5.6,
    price: 8.49,
    stock: 62,
    minStock: 12,
    catalog: true,
    description: "Feijão carioca selecionado, cozimento rápido.",
  },
  {
    name: "Café torrado e moído 500 g",
    sku: "CAF-500",
    barcode: SCAN_BARCODE,
    category: "Mercearia",
    cost: 13.5,
    price: 19.9,
    stock: 30,
    minStock: 8,
    catalog: true,
    description: "Torra média, aroma intenso.",
  },
  {
    name: "Açúcar cristal 5 kg",
    sku: "ACU-5",
    barcode: "7891000100400",
    category: "Mercearia",
    cost: 16.2,
    price: 22.5,
    stock: 25,
    minStock: 6,
    catalog: true,
  },
  {
    name: "Óleo de soja 900 ml",
    sku: "OLE-900",
    barcode: "7891000100509",
    category: "Mercearia",
    cost: 5.1,
    price: 7.29,
    stock: 4,
    minStock: 12,
    catalog: true,
  },
  {
    name: "Leite integral 1 L",
    sku: "LEI-1",
    barcode: "7891000100608",
    category: "Bebidas",
    cost: 3.9,
    price: 5.49,
    unit: Unit.LT,
    stock: 96,
    minStock: 24,
    catalog: true,
  },
  {
    name: "Água mineral 1,5 L",
    sku: "AGU-15",
    barcode: "7891000100707",
    category: "Bebidas",
    cost: 1.4,
    price: 2.99,
    stock: 120,
    minStock: 24,
    catalog: true,
  },
  {
    name: "Refrigerante cola 2 L",
    sku: "REF-2",
    barcode: "7891000100806",
    category: "Bebidas",
    cost: 6.2,
    price: 9.99,
    stock: 36,
    minStock: 12,
    catalog: true,
  },
  {
    name: "Banana prata",
    sku: "BAN-KG",
    category: "Hortifrúti",
    cost: 3.2,
    price: 5.99,
    unit: Unit.KG,
    stock: 22.5,
    minStock: 5,
    catalog: true,
  },
  {
    name: "Tomate italiano",
    sku: "TOM-KG",
    category: "Hortifrúti",
    cost: 4.5,
    price: 7.99,
    unit: Unit.KG,
    stock: 14.2,
    minStock: 5,
    catalog: true,
  },
  {
    name: "Queijo minas frescal",
    sku: "QMF-KG",
    category: "Hortifrúti",
    cost: 28,
    price: 42.9,
    unit: Unit.KG,
    stock: 6.8,
    minStock: 2,
  },
  {
    name: "Ração cães adultos 15 kg",
    sku: "RAC-15",
    barcode: "7891000100905",
    category: "Ração e Pet",
    cost: 98,
    price: 139.9,
    stock: 12,
    minStock: 4,
    catalog: true,
    description: "Ração completa para cães adultos de porte médio e grande.",
  },
  {
    name: "Ração gatos 1 kg",
    sku: "RGT-1",
    barcode: "7891000101001",
    category: "Ração e Pet",
    cost: 14.5,
    price: 21.9,
    stock: 3,
    minStock: 6,
    catalog: true,
  },
  {
    name: "Milho em grão 25 kg",
    sku: "MIL-25",
    category: "Agro e Jardim",
    cost: 52,
    price: 74.9,
    stock: 18,
    minStock: 5,
    catalog: true,
    description: "Milho para trato animal, saca de 25 kg.",
  },
  {
    name: "Adubo NPK 10-10-10 5 kg",
    sku: "NPK-5",
    category: "Agro e Jardim",
    cost: 24,
    price: 36.9,
    stock: 20,
    minStock: 4,
    catalog: true,
  },
  {
    name: "Mangueira de jardim 20 m",
    sku: "MAN-20",
    category: "Agro e Jardim",
    cost: 48,
    price: 79.9,
    unit: Unit.UN,
    stock: 7,
    minStock: 2,
  },
  {
    name: "Arame galvanizado",
    sku: "ARA-M",
    category: "Agro e Jardim",
    cost: 0.9,
    price: 1.6,
    unit: Unit.M,
    stock: 350,
    minStock: 100,
  },
  {
    name: "Detergente líquido 500 ml",
    sku: "DET-500",
    barcode: "7891000101100",
    category: "Limpeza",
    cost: 1.7,
    price: 2.79,
    stock: 54,
    minStock: 12,
    catalog: true,
  },
  {
    name: "Sabão em pó 1,6 kg",
    sku: "SAB-16",
    barcode: "7891000101209",
    category: "Limpeza",
    cost: 14.9,
    price: 21.5,
    stock: 16,
    minStock: 6,
    catalog: true,
  },
  {
    name: "Água sanitária 2 L",
    sku: "AGS-2",
    barcode: "7891000101308",
    category: "Limpeza",
    cost: 4.1,
    price: 6.49,
    stock: 28,
    minStock: 8,
  },
];

const CUSTOMERS = [
  { name: "Sítio Boa Vista", document: "11222333000181", phone: "35999990001" },
  { name: "João Pereira", phone: "35999990002" },
  { name: "Maria Aparecida Santos", phone: "35999990003" },
  { name: "Padaria Pão Quente", document: "22333444000172", phone: "35999990004" },
  { name: "Carlos Henrique Rocha", phone: "35999990005" },
  { name: "Fazenda Três Irmãos", document: "33444555000163", phone: "35999990006" },
];

const SUPPLIERS = [
  { name: "Distribuidora Vale Verde", document: "44555666000154", phone: "3532210000" },
  { name: "Cerealista São Bento", document: "55666777000145", phone: "3532220000" },
  { name: "AgroSul Insumos", document: "66777888000136", phone: "3532230000" },
];

const PAYMENTS: PaymentMethod[] = [
  PaymentMethod.PIX,
  PaymentMethod.PIX,
  PaymentMethod.PIX,
  PaymentMethod.MONEY,
  PaymentMethod.MONEY,
  PaymentMethod.DEBIT_CARD,
  PaymentMethod.CREDIT_CARD,
  PaymentMethod.CREDIT_CARD,
  PaymentMethod.ON_ACCOUNT,
];

async function createUser(name: string, email: string, role: Role, hash: string) {
  return db.user.create({ data: { name, email, password: hash, role } });
}

/** Loja de demonstração: cadastros, 30 dias de vendas, caixa aberto, fiado e pedidos do catálogo. */
export async function seedShowcase() {
  seed = 42;
  await resetDatabase();
  const hash = await bcrypt.hash(PASSWORD, 4);
  const admin = await createUser("Marina Costa", ADMIN_EMAIL, Role.ADMIN, hash);
  const manager = await createUser("Rafael Lima", MANAGER_EMAIL, Role.MANAGER, hash);
  const seller = await createUser("Ana Souza", SELLER_EMAIL, Role.SELLER, hash);
  const operators = [admin, seller, seller, manager];

  await db.storeSettings.create({
    data: {
      id: "default",
      companyName: "Boa Safra Comércio de Alimentos Ltda",
      tradeName: "Mercado Boa Safra",
      document: "12345678000195",
      phone: "3532100000",
      email: "contato@boasafra.demo",
      zipCode: "37500000",
      address: "Rua das Palmeiras",
      number: "120",
      neighborhood: "Centro",
      city: "Itajubá",
      state: "MG",
      instagram: "@mercadoboasafra",
      whatsappNumber: "5535999990000",
      receiptFooterNote: "Obrigado pela preferência!",
      catalogEnabled: true,
      onAccountEnabled: true,
      onAccountDueDays: 30,
      defaultProfitMargin: money(40),
    },
  });

  const categories = new Map<string, string>();
  for (const name of CATEGORIES) {
    categories.set(name, (await db.category.create({ data: { name } })).id);
  }

  const suppliers = [];
  for (const supplier of SUPPLIERS) suppliers.push(await db.supplier.create({ data: supplier }));

  const products: Awaited<ReturnType<typeof db.product.create>>[] = [];
  for (const p of PRODUCTS) {
    const product = await db.product.create({
      data: {
        name: p.name,
        sku: p.sku,
        barcode: p.barcode,
        costPrice: money(p.cost),
        salePrice: money(p.price),
        unit: p.unit ?? Unit.UN,
        currentStock: qty(p.stock),
        minStock: qty(p.minStock ?? 0),
        categoryId: categories.get(p.category),
        showInCatalog: p.catalog ?? false,
        description: p.description,
      },
    });
    products.push(product);
    // Entrada de mercadoria do fornecedor, há duas a três semanas
    const entry = Math.max(p.stock * 1.6, 1);
    await db.stockMovement.create({
      data: {
        productId: product.id,
        type: "IN",
        quantity: qty(entry.toFixed(3)),
        reason: "Entrada de mercadoria (NF)",
        unitCost: money(p.cost),
        totalCost: money((entry * p.cost).toFixed(2)),
        userId: manager.id,
        supplierId: pick(suppliers).id,
        createdAt: daysAgo(14 + Math.floor(random() * 7), 9, 30),
      },
    });
  }

  // Caixa com 12 latas avulsas a partir de caixas de 12 (abertura de caixa, issue #84)
  const can = await db.product.create({
    data: {
      name: "Cerveja lata 350 ml",
      sku: "CER-UN",
      barcode: "7891000101407",
      costPrice: money(2.9),
      salePrice: money(4.49),
      unit: Unit.UN,
      currentStock: qty(18),
      minStock: qty(24),
      categoryId: categories.get("Bebidas"),
      showInCatalog: true,
    },
  });
  await db.product.create({
    data: {
      name: "Cerveja lata 350 ml — caixa 12 un",
      sku: "CER-CX12",
      costPrice: money(33),
      salePrice: money(49.9),
      unit: Unit.CX,
      currentStock: qty(9),
      minStock: qty(3),
      categoryId: categories.get("Bebidas"),
      containedProductId: can.id,
      unitsPerBox: 12,
      showInCatalog: true,
    },
  });
  products.push(can);

  const customers = [];
  for (const customer of CUSTOMERS) customers.push(await db.customer.create({ data: customer }));

  // Caixas fechados dos dias anteriores (histórico) e o caixa aberto de hoje da administradora
  const closedRegisters = [];
  for (let day = 6; day >= 1; day--) {
    const user = day % 2 ? seller : admin;
    closedRegisters.push(
      await db.cashRegister.create({
        data: {
          userId: user.id,
          status: "CLOSED",
          openingAmount: money(150),
          openedAt: daysAgo(day, 7, 50),
          closedAt: daysAgo(day, 19, 5),
          expectedAmount: money(980 + day * 37),
          countedAmount: money(980 + day * 37 - (day === 3 ? 4.5 : 0)),
          difference: money(day === 3 ? -4.5 : 0),
          closingNote: day === 3 ? "Diferença de troco conferida." : null,
        },
      }),
    );
  }
  const openRegister = await db.cashRegister.create({
    data: {
      userId: admin.id,
      openUserId: admin.id,
      openingAmount: money(200),
      openedAt: daysAgo(0, 7, 45),
    },
  });
  const sellerRegister = await db.cashRegister.create({
    data: {
      userId: seller.id,
      openUserId: seller.id,
      openingAmount: money(150),
      openedAt: daysAgo(0, 7, 55),
    },
  });
  await db.cashMovement.createMany({
    data: [
      {
        cashRegisterId: openRegister.id,
        type: CashMovementType.SUPPLY,
        amount: money(100),
        reason: "Reforço de troco",
        userId: admin.id,
        createdAt: daysAgo(0, 9, 10),
      },
      {
        cashRegisterId: openRegister.id,
        type: CashMovementType.WITHDRAWAL,
        amount: money(300),
        reason: "Sangria para o cofre",
        userId: admin.id,
        createdAt: daysAgo(0, 11, 40),
      },
    ],
  });

  // Vendas dos últimos 30 dias, mais movimento nos fins de semana
  const now = new Date();
  for (let day = 29; day >= 0; day--) {
    const date = daysAgo(day, 12);
    const weekend = date.getDay() === 0 || date.getDay() === 6;
    const count = (weekend ? 9 : 5) + Math.floor(random() * 5);
    for (let i = 0; i < count; i++) {
      const occurredAt = daysAgo(day, 8 + Math.floor(random() * 10), Math.floor(random() * 60));
      if (occurredAt > now) continue;
      const user = day === 0 ? pick([admin, seller]) : pick(operators);
      const register =
        day === 0
          ? user.id === admin.id
            ? openRegister
            : sellerRegister
          : day <= 6
            ? closedRegisters[6 - day]
            : null;
      const lines = 1 + Math.floor(random() * 4);
      const items = [];
      const used = new Set<string>();
      for (let l = 0; l < lines; l++) {
        const product = pick(products);
        if (used.has(product.id)) continue;
        used.add(product.id);
        const fractional = product.unit === Unit.KG || product.unit === Unit.M;
        const quantity = fractional
          ? product.unit === Unit.M
            ? 10 + Math.floor(random() * 30)
            : Number((0.3 + random() * 2).toFixed(3))
          : 1 + Math.floor(random() * 3);
        const unitPrice = Number(product.salePrice);
        items.push({
          productId: product.id,
          quantity: qty(quantity),
          unitPrice: money(unitPrice),
          subtotal: money((quantity * unitPrice).toFixed(2)),
        });
      }
      const total = items.reduce((sum, item) => sum + Number(item.subtotal), 0);
      let payment = pick(PAYMENTS);
      const customer =
        payment === PaymentMethod.ON_ACCOUNT || random() < 0.25 ? pick(customers) : null;
      if (payment === PaymentMethod.ON_ACCOUNT && !customer) payment = PaymentMethod.PIX;
      const sale = await db.sale.create({
        data: {
          total: money(total.toFixed(2)),
          paymentMethod: payment,
          userId: user.id,
          customerId: customer?.id,
          cashRegisterId: register?.id,
          occurredAt,
          createdAt: occurredAt,
          items: { create: items },
        },
      });
      if (payment === PaymentMethod.ON_ACCOUNT && customer) {
        const paid =
          day > 12 ? total : day > 5 && random() < 0.5 ? Number((total / 2).toFixed(2)) : 0;
        const dueDate = new Date(occurredAt);
        dueDate.setDate(dueDate.getDate() + 30);
        const receivable = await db.receivable.create({
          data: {
            saleId: sale.id,
            customerId: customer.id,
            amount: money(total.toFixed(2)),
            paidAmount: money(paid),
            status: paid >= total ? "PAID" : paid > 0 ? "PARTIAL" : "OPEN",
            dueDate,
            createdAt: occurredAt,
          },
        });
        if (paid > 0) {
          await db.receivablePayment.create({
            data: {
              receivableId: receivable.id,
              amount: money(paid),
              method: PaymentMethod.PIX,
              userId: manager.id,
              createdAt: daysAgo(Math.max(day - 3, 0), 10),
            },
          });
        }
      }
    }
  }

  // Ajuste de inventário recente (aparece nas movimentações do estoque)
  await db.stockMovement.create({
    data: {
      productId: products[4].id,
      type: "ADJUSTMENT",
      quantity: qty(-2),
      reason: "Avaria no recebimento",
      userId: manager.id,
      createdAt: daysAgo(1, 16, 20),
    },
  });

  // Pedidos que chegaram pelo catálogo (WhatsApp) e aguardam no PDV
  const orders = [
    {
      name: "Juliana Mendes",
      phone: "35988880001",
      items: [
        [0, 2],
        [1, 3],
        [5, 6],
      ],
    },
    {
      name: "Sítio Boa Vista",
      phone: "35999990001",
      items: [
        [13, 4],
        [11, 1],
      ],
    },
    {
      name: "Pedro Alves",
      phone: "35988880003",
      items: [
        [2, 2],
        [7, 2],
        [17, 4],
      ],
    },
  ] as const;
  for (const [index, order] of orders.entries()) {
    const lines = order.items.map(([productIndex, quantity]) => {
      const product = products[productIndex];
      const unitPrice = Number(product.salePrice);
      return {
        productId: product.id,
        productName: product.name,
        unit: product.unit,
        quantity: qty(quantity),
        unitPrice: money(unitPrice),
        subtotal: money((quantity * unitPrice).toFixed(2)),
      };
    });
    await db.catalogOrder.create({
      data: {
        requestKey: randomUUID(),
        payloadHash: randomUUID().replace(/-/g, ""),
        createdById: admin.id,
        customerName: order.name,
        customerPhone: order.phone,
        customerId: order.name === "Sítio Boa Vista" ? customers[0].id : null,
        estimatedTotal: money(
          lines.reduce((sum, line) => sum + Number(line.subtotal), 0).toFixed(2),
        ),
        createdAt: new Date(Date.now() - (index + 1) * 47 * 60_000),
        items: { create: lines },
      },
    });
  }
}

/** Tema fixo antes de qualquer script da página (next-themes lê o localStorage). */
