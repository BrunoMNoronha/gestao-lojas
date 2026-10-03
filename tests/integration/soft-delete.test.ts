import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma, ReceivableStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { registerSale } from "@/lib/create-sale";
import { CATALOG_SORTS } from "@/lib/catalog-shared";
import { resetDatabase, saleInput, seedStore, type Store } from "./fixtures";

// Exclusão lógica de produtos, clientes e categorias (issue #36, docs/OFFLINE.md seção 3.7):
// "excluir" marca deletedAt, o registro some das telas atuais e a unicidade vale só entre ativos.
// A sessão do Auth.js e o cache do Next são simulados; o perfil é ADMIN (todas as permissões).
const { authorize, revalidatePath } = vi.hoisted(() => ({
  authorize: vi.fn(),
  revalidatePath: vi.fn(),
}));
vi.mock("@/lib/authz", () => ({ authorize }));
vi.mock("next/cache", () => ({ revalidatePath }));

const { getProducts, createProduct, updateProduct, deleteProduct } =
  await import("@/actions/products");
const { getCustomers, createCustomer, updateCustomer, deleteCustomer } =
  await import("@/actions/customers");
const { getCategories, createCategory, updateCategory, deleteCategory } =
  await import("@/actions/categories");
const { getLowStockProducts, registerStockEntry } = await import("@/actions/stock");
const { getCatalogProducts, getCatalogCategories, getCatalogProduct } =
  await import("@/lib/catalog");

let store: Store;

beforeEach(async () => {
  await resetDatabase();
  store = await seedStore();
  authorize.mockReset();
  authorize.mockResolvedValue({
    ok: true,
    user: { id: store.user.id, name: store.user.name, role: "ADMIN" },
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});

const ids = (rows: { id: string }[]) => rows.map((row) => row.id).sort();

describe("produtos", () => {
  it("exclui produto com vendas e movimentações, mantendo o histórico", async () => {
    // Antes da #36 a exclusão física falhava pela chave estrangeira das vendas
    const sale = await registerSale(store.user.id, saleInput(store));
    expect(sale.success).toBe(true);

    const result = await deleteProduct(store.rice.id);

    expect(result).toEqual({ success: true });
    const row = await prisma.product.findUniqueOrThrow({ where: { id: store.rice.id } });
    expect(row.deletedAt).not.toBeNull();
    expect(await prisma.saleItem.count({ where: { productId: store.rice.id } })).toBe(1);
    expect(await prisma.stockMovement.count({ where: { productId: store.rice.id } })).toBe(1);
    expect(ids(await getProducts())).toEqual([store.cheese.id]);
  });

  it("produto excluído some do estoque baixo, do catálogo e da venda online", async () => {
    await prisma.product.update({
      where: { id: store.rice.id },
      data: { showInCatalog: true, minStock: 50 },
    });
    expect(ids(await getLowStockProducts())).toContain(store.rice.id);

    await deleteProduct(store.rice.id);

    expect(ids(await getLowStockProducts())).not.toContain(store.rice.id);
    const catalog = await getCatalogProducts({
      q: "",
      category: "",
      page: 1,
      sort: CATALOG_SORTS[0],
      available: false,
    });
    expect(catalog!.total).toBe(0);
    expect(await getCatalogProduct(store.rice.id)).toBeNull();

    const sale = await registerSale(store.user.id, saleInput(store));
    expect(sale).toEqual({
      success: false,
      error: "Um dos produtos do carrinho não existe mais. Atualize a tela.",
    });

    const entry = await registerStockEntry({ productId: store.rice.id, quantity: 1 });
    expect(entry).toEqual({ success: false, error: "Produto não encontrado. Atualize a tela." });
  });

  it("libera SKU e código de barras do produto excluído", async () => {
    const first = await createProduct({
      name: "Feijão",
      sku: "FEI-1",
      barcode: "7890000000001",
      costPrice: 4,
      salePrice: 8,
    });
    expect(first.success).toBe(true);

    const duplicate = await createProduct({
      name: "Outro",
      sku: "FEI-1",
      costPrice: 1,
      salePrice: 2,
    });
    expect(duplicate).toEqual({ success: false, error: "Já existe um produto com este SKU." });

    await deleteProduct(first.data!.id);
    const again = await createProduct({
      name: "Feijão novo",
      sku: "FEI-1",
      barcode: "7890000000001",
      costPrice: 4,
      salePrice: 9,
    });
    expect(again.success).toBe(true);
  });

  it("o banco recusa SKU repetido entre produtos ativos (índice único parcial)", async () => {
    const data = { name: "X", sku: "DUP", costPrice: 1, salePrice: 2 };
    await prisma.product.create({ data });

    const error = await prisma.product.create({ data }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    expect((error as Prisma.PrismaClientKnownRequestError).code).toBe("P2002");
  });

  it("não edita nem exclui de novo um produto excluído", async () => {
    await deleteProduct(store.rice.id);
    const message = "Produto não encontrado. Ele pode ter sido excluído; atualize a tela.";

    expect(await deleteProduct(store.rice.id)).toEqual({ success: false, error: message });
    expect(
      await updateProduct(store.rice.id, { name: "Arroz", costPrice: 6, salePrice: 11 }),
    ).toEqual({ success: false, error: message });
  });

  it("registra o histórico do preço de venda no cadastro e a cada mudança", async () => {
    const created = await createProduct({ name: "Óleo", costPrice: 5, salePrice: 7.5 });
    const id = created.data!.id;

    await updateProduct(id, { name: "Óleo de soja", costPrice: 5, salePrice: 7.5 });
    await updateProduct(id, { name: "Óleo de soja", costPrice: 5, salePrice: 8.25 });
    await prisma.product.update({ where: { id }, data: { currentStock: 3 } });

    const history = await prisma.productPrice.findMany({
      where: { productId: id },
      orderBy: { id: "asc" },
    });
    // Mudança de nome e de estoque não gera linha; só o cadastro e a troca de preço
    expect(history.map((row) => row.salePrice.toFixed(2))).toEqual(["7.50", "8.25"]);
    expect(history[1].validFrom.getTime()).toBeGreaterThanOrEqual(history[0].validFrom.getTime());
  });
});

describe("clientes", () => {
  it("exclui cliente com vendas pagas, mas não com Fiado em aberto", async () => {
    const sale = await registerSale(
      store.user.id,
      saleInput(store, { customerId: store.customer.id }),
    );
    if (!sale.success) throw new Error(sale.error);
    const receivable = await prisma.receivable.create({
      data: {
        saleId: sale.data.id,
        customerId: store.customer.id,
        amount: new Prisma.Decimal("42.95"),
        status: ReceivableStatus.PARTIAL,
      },
    });

    expect(await deleteCustomer(store.customer.id)).toEqual({
      success: false,
      error: "Não é possível excluir este cliente pois existem 1 título(s) de Fiado em aberto.",
    });

    await prisma.receivable.update({
      where: { id: receivable.id },
      data: { status: ReceivableStatus.PAID },
    });
    expect(await deleteCustomer(store.customer.id)).toEqual({ success: true });
    expect(await getCustomers()).toEqual([]);
    expect(await prisma.sale.count({ where: { customerId: store.customer.id } })).toBe(1);

    // Venda online não aceita mais o cliente excluído
    const next = await registerSale(
      store.user.id,
      saleInput(store, { customerId: store.customer.id }),
    );
    expect(next).toEqual({ success: false, error: "Cliente selecionado não foi encontrado." });
  });

  it("libera o documento do cliente excluído", async () => {
    const first = await createCustomer({ name: "Maria", document: "529.982.247-25" });
    expect(first.success).toBe(true);
    expect(await createCustomer({ name: "Outra", document: "52998224725" })).toEqual({
      success: false,
      error: "Já existe um cliente cadastrado com este documento (CPF/CNPJ).",
    });

    await deleteCustomer(first.data!.id);

    const again = await createCustomer({ name: "Maria Souza", document: "52998224725" });
    expect(again.success).toBe(true);
    expect(await updateCustomer(first.data!.id, { name: "Maria" })).toEqual({
      success: false,
      error: "Cliente não encontrado. Ele pode ter sido excluído; atualize a tela.",
    });
  });
});

describe("categorias", () => {
  it("só produtos ativos impedem a exclusão e entram na contagem", async () => {
    const created = await createCategory("Grãos");
    const categoryId = created.data!.id;
    await prisma.product.update({ where: { id: store.rice.id }, data: { categoryId } });

    expect(await deleteCategory(categoryId)).toEqual({
      success: false,
      error: "Não é possível excluir esta categoria pois existem 1 produto(s) vinculados a ela.",
    });

    await deleteProduct(store.rice.id);
    expect(await getCategories()).toEqual([
      { id: categoryId, name: "Grãos", _count: { products: 0 } },
    ]);

    expect(await deleteCategory(categoryId)).toEqual({ success: true });
    expect(await getCategories()).toEqual([]);
    expect(await updateCategory(categoryId, "Cereais")).toEqual({
      success: false,
      error: "Categoria não encontrada. Ela pode ter sido excluída; atualize a tela.",
    });

    // O nome fica livre para uma categoria nova
    expect((await createCategory("Grãos")).success).toBe(true);
  });

  it("categoria excluída some do catálogo público", async () => {
    const created = await createCategory("Laticínios");
    const categoryId = created.data!.id;
    await prisma.product.update({
      where: { id: store.cheese.id },
      data: { categoryId, showInCatalog: true },
    });
    expect(ids(await getCatalogCategories())).toEqual([categoryId]);

    await prisma.category.update({ where: { id: categoryId }, data: { deletedAt: new Date() } });

    expect(await getCatalogCategories()).toEqual([]);
  });
});
