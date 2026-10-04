import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  offlineEffectCounts,
  offlineSale,
  prepareOffline,
  resetDatabase,
  seedStore,
  type OfflineContext,
  type Store,
} from "./fixtures";

// Route Handler POST /api/offline/operations (issue #38, docs/OFFLINE.md seção 5). Usa o
// authorize() real (usuário ativo e perfil conferidos no banco); só a sessão do Auth.js e o cache
// do Next são simulados.
const { auth, revalidatePath } = vi.hoisted(() => ({
  auth: vi.fn(),
  revalidatePath: vi.fn(),
}));
vi.mock("@/auth", () => ({ auth }));
vi.mock("next/cache", () => ({ revalidatePath }));

const { POST } = await import("@/app/api/offline/operations/route");

let store: Store;
let ctx: OfflineContext;

beforeEach(async () => {
  await resetDatabase();
  store = await seedStore();
  const { device, grant } = await prepareOffline(store.user.id, store.cashRegister.id);
  ctx = {
    userId: store.user.id,
    deviceId: device.id,
    grantId: grant.id,
    cashRegisterId: store.cashRegister.id,
  };
  auth.mockReset();
  auth.mockResolvedValue({ user: { id: store.user.id } });
  revalidatePath.mockReset();
});

afterAll(async () => {
  await prisma.$disconnect();
});

function post(body: unknown, contentType = "application/json") {
  return POST(
    new Request("http://localhost/api/offline/operations", {
      method: "POST",
      headers: { "Content-Type": contentType },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

const batch = (operations: unknown[]) => ({ protocolVersion: 1, operations });

describe("POST /api/offline/operations", () => {
  it("devolve o resultado de cada operação e revalida as telas", async () => {
    const ok = offlineSale(store, ctx);
    const fiado = offlineSale(store, ctx, {}, { paymentMethod: "ON_ACCOUNT", amountPaid: null });
    const broken = { ...offlineSale(store, ctx), operationId: "x" };

    const res = await post(batch([ok, fiado, broken]));
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const body = await res.json();
    expect(body.protocolVersion).toBe(1);
    expect(body.results).toMatchObject([
      { operationId: ok.operationId, status: "applied", replayed: false },
      { operationId: fiado.operationId, status: "conflict", reason: "ON_ACCOUNT_OFFLINE" },
      { operationId: null, status: "invalid" },
    ]);
    expect(revalidatePath).toHaveBeenCalledWith("/admin/caixa");
    expect(revalidatePath).toHaveBeenCalledWith("/admin/relatorios/vendas");
  });

  it("repetir o lote inteiro (resposta perdida) não duplica nada", async () => {
    const ops = [offlineSale(store, ctx), offlineSale(store, ctx)];
    const first = await (await post(batch(ops))).json();
    const second = await (await post(batch(ops))).json();

    expect(second.results.map((r: { status: string }) => r.status)).toEqual(["applied", "applied"]);
    expect(second.results.every((r: { replayed: boolean }) => r.replayed)).toBe(true);
    expect(second.results.map((r: { sale: unknown }) => r.sale)).toEqual(
      first.results.map((r: { sale: unknown }) => r.sale),
    );
    expect(await offlineEffectCounts()).toMatchObject({ sales: 2, operations: 2 });
  });

  it("sem sessão (expirada) responde 401 e não grava nada", async () => {
    auth.mockResolvedValue(null);
    const res = await post(batch([offlineSale(store, ctx)]));
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: "unauthenticated" });
    expect(await offlineEffectCounts()).toMatchObject({ sales: 0, operations: 0 });
  });

  it("operador desativado durante a desconexão não sincroniza (401)", async () => {
    await prisma.user.update({ where: { id: store.user.id }, data: { active: false } });
    const res = await post(batch([offlineSale(store, ctx)]));
    expect(res.status).toBe(401);
    expect(await offlineEffectCounts()).toMatchObject({ sales: 0, operations: 0 });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("recusa corpo que não é JSON, versão desconhecida e lote vazio ou grande demais", async () => {
    expect((await post(batch([offlineSale(store, ctx)]), "text/plain")).status).toBe(400);
    expect((await post("{", "application/json")).status).toBe(400);
    expect((await post({ protocolVersion: 2, operations: [offlineSale(store, ctx)] })).status).toBe(
      400,
    );
    expect((await post(batch([]))).status).toBe(400);
    const tooMany = Array.from({ length: 51 }, () => offlineSale(store, ctx));
    expect((await post(batch(tooMany))).status).toBe(400);
    expect(await offlineEffectCounts()).toMatchObject({ sales: 0, operations: 0 });
  });

  it("só conflitos: não revalida as telas", async () => {
    const fiado = offlineSale(store, ctx, {}, { paymentMethod: "ON_ACCOUNT", amountPaid: null });
    const res = await post(batch([fiado]));
    expect(res.status).toBe(200);
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
