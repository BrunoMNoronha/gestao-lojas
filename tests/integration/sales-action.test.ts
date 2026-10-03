import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { effectCounts, resetDatabase, saleInput, seedStore, type Store } from "./fixtures";

// Server Action createSale: autoriza com "pdv.use", atribui a venda ao operador da sessão e
// revalida as telas. A sessão do Auth.js e o cache do Next são simulados.
const { authorize, revalidatePath } = vi.hoisted(() => ({
  authorize: vi.fn(),
  revalidatePath: vi.fn(),
}));
vi.mock("@/lib/authz", () => ({ authorize }));
vi.mock("next/cache", () => ({ revalidatePath }));

const { createSale } = await import("@/actions/sales");

let store: Store;

beforeEach(async () => {
  await resetDatabase();
  store = await seedStore();
  authorize.mockReset();
  revalidatePath.mockReset();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("createSale (Server Action)", () => {
  it("sem permissão não grava nada", async () => {
    authorize.mockResolvedValue({
      ok: false,
      error: "Você não tem permissão para realizar esta ação.",
    });

    const result = await createSale(saleInput(store));

    expect(authorize).toHaveBeenCalledWith("pdv.use");
    expect(result).toEqual({
      success: false,
      error: "Você não tem permissão para realizar esta ação.",
    });
    expect((await effectCounts()).sales).toBe(0);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("grava a venda do operador da sessão e revalida as telas, também no reenvio", async () => {
    authorize.mockResolvedValue({
      ok: true,
      user: { id: store.user.id, name: store.user.name, role: "SELLER" },
    });
    const input = saleInput(store);

    const first = await createSale(input);
    const second = await createSale(input);

    expect(first.success).toBe(true);
    expect(second).toEqual(first);
    const sale = await prisma.sale.findFirstOrThrow();
    expect(sale.userId).toBe(store.user.id);
    expect((await effectCounts()).sales).toBe(1);
    expect(revalidatePath).toHaveBeenCalledWith("/admin/pdv");
    expect(revalidatePath).toHaveBeenCalledWith("/admin/caixa");
    expect(revalidatePath).toHaveBeenCalledTimes(10);
  });
});
