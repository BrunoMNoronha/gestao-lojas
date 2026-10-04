import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { Role } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { TEST_DATA_LIMITS } from "@/lib/test-data-generator";
import { resetDatabase, seedStore } from "./fixtures";

// Server Actions da seção "Dados de teste" (issue #57). Usa o authorize() real (perfil e situação
// conferidos no banco); só a sessão do Auth.js e o cache do Next são simulados.
const { auth, revalidatePath } = vi.hoisted(() => ({
  auth: vi.fn(),
  revalidatePath: vi.fn(),
}));
vi.mock("@/auth", () => ({ auth }));
vi.mock("next/cache", () => ({ revalidatePath }));

const { generateTestDataAction, getTestDataOverview, resetStoreDataAction } =
  await import("@/actions/test-data");

const PASSWORD = "senha-do-admin-123";
const COUNTS = { categories: 2, products: 4, customers: 2, suppliers: 1 };

async function createUser(role: Role, active = true) {
  return prisma.user.create({
    data: {
      name: `Usuário ${role}`,
      email: `${randomUUID()}@teste.local`,
      password: await bcrypt.hash(PASSWORD, 4),
      role,
      active,
    },
  });
}

const signIn = (id: string | null) => auth.mockResolvedValue(id ? { user: { id } } : null);

async function dataCounts() {
  const [products, customers, suppliers, categories] = await Promise.all([
    prisma.product.count(),
    prisma.customer.count(),
    prisma.supplier.count(),
    prisma.category.count(),
  ]);
  return { products, customers, suppliers, categories };
}

beforeEach(async () => {
  await resetDatabase();
  await prisma.storeSettings.create({
    data: { id: "default", companyName: "Loja Teste Ltda", tradeName: "Loja Teste" },
  });
  auth.mockReset();
  revalidatePath.mockReset();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("permissão", () => {
  it.each([
    ["sem sessão", null],
    ["MANAGER", Role.MANAGER],
    ["SELLER", Role.SELLER],
    ["ADMIN inativo", "inactive"],
  ] as const)("%s não vê a seção nem gera ou restaura", async (_, who) => {
    const store = await seedStore();
    await prisma.cashRegister.update({
      where: { id: store.cashRegister.id },
      data: { status: "CLOSED", openUserId: null, closedAt: new Date() },
    });
    if (who === null) signIn(null);
    else if (who === "inactive") signIn((await createUser(Role.ADMIN, false)).id);
    else signIn((await createUser(who)).id);
    const before = await dataCounts();

    expect(await getTestDataOverview()).toBeNull();
    const generated = await generateTestDataAction({ requestId: randomUUID(), counts: COUNTS });
    const reset = await resetStoreDataAction({
      requestId: randomUUID(),
      tradeName: "Loja Teste",
      password: PASSWORD,
    });

    expect(generated.success).toBe(false);
    expect(reset.success).toBe(false);
    expect(await dataCounts()).toEqual(before);
    expect(await prisma.testDataRun.count()).toBe(0);
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("ADMIN", () => {
  let adminId: string;

  beforeEach(async () => {
    adminId = (await createUser(Role.ADMIN)).id;
    signIn(adminId);
  });

  it("vê tetos, impedimentos, histórico e o nome da loja", async () => {
    const store = await seedStore();
    await generateTestDataAction({ requestId: randomUUID(), counts: COUNTS });

    const overview = await getTestDataOverview();

    expect(overview).toMatchObject({
      limits: TEST_DATA_LIMITS,
      defaults: TEST_DATA_LIMITS,
      tradeName: "Loja Teste",
      blockers: {
        openCashRegisters: [expect.objectContaining({ id: store.cashRegister.id })],
        pendingDevices: [],
      },
    });
    expect(overview?.runs).toEqual([
      expect.objectContaining({ kind: "GENERATE", status: "COMPLETED", userName: "Usuário ADMIN" }),
    ]);
  });

  it("sem configurações salvas, o nome da loja vem nulo", async () => {
    await prisma.storeSettings.deleteMany();
    expect((await getTestDataOverview())?.tradeName).toBeNull();
  });

  it("gera, grava o autor da sessão e revalida o painel e o catálogo", async () => {
    const result = await generateTestDataAction({ requestId: randomUUID(), counts: COUNTS });

    expect(result).toEqual({
      success: true,
      data: {
        replayed: false,
        counts: { categories: 2, products: 4, customers: 2, suppliers: 1, stockMovements: 4 },
      },
    });
    expect(await prisma.testDataRun.findFirst()).toMatchObject({ userId: adminId });
    expect(revalidatePath).toHaveBeenCalledWith("/admin", "layout");
    expect(revalidatePath).toHaveBeenCalledWith("/catalogo", "layout");
  });

  it("recusa entrada malformada sem gravar dados nem revalidar", async () => {
    const bad = await generateTestDataAction({
      requestId: randomUUID(),
      counts: { ...COUNTS, products: 999 },
    });
    // Chamada direta com corpo inesperado (fora do tipo)
    const garbage = await generateTestDataAction(null as never);

    expect(bad.success).toBe(false);
    expect(garbage.success).toBe(false);
    expect(await dataCounts()).toEqual({ products: 0, customers: 0, suppliers: 0, categories: 0 });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("restauração recusada devolve os impedimentos e não revalida", async () => {
    const store = await seedStore();

    const result = await resetStoreDataAction({
      requestId: randomUUID(),
      tradeName: "Loja Teste",
      password: PASSWORD,
    });

    expect(result).toMatchObject({
      success: false,
      blockers: { openCashRegisters: [expect.objectContaining({ id: store.cashRegister.id })] },
    });
    expect(await prisma.product.count()).toBe(2);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("restaura com a confirmação correta e revalida", async () => {
    await generateTestDataAction({ requestId: randomUUID(), counts: COUNTS });
    revalidatePath.mockReset();

    const wrong = await resetStoreDataAction({
      requestId: randomUUID(),
      tradeName: "Loja Teste",
      password: "errada",
    });
    expect(wrong).toEqual({ success: false, error: "Nome da loja ou senha incorretos." });
    expect(revalidatePath).not.toHaveBeenCalled();

    const result = await resetStoreDataAction({
      requestId: randomUUID(),
      tradeName: "Loja Teste",
      password: PASSWORD,
    });

    expect(result).toMatchObject({ success: true, data: { replayed: false } });
    if (result.success) expect(result.data.counts.Product).toBe(4);
    expect(await dataCounts()).toEqual({ products: 0, customers: 0, suppliers: 0, categories: 0 });
    expect(await prisma.user.count()).toBe(1);
    expect(revalidatePath).toHaveBeenCalledWith("/admin", "layout");
    expect(revalidatePath).toHaveBeenCalledWith("/catalogo", "layout");
  });
});
