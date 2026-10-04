import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import type { SessionUser } from "@/lib/authz";
import {
  OFFLINE_GRANT_HOURS,
  OfflinePrepareError,
  prepareOfflineDevice,
  type OfflinePreparation,
} from "@/lib/offline-device";
import { createUser, openCashRegister, resetDatabase, seedStore, type Store } from "./fixtures";

// Preparação do aparelho para o PDV offline (issue #37, docs/OFFLINE.md seções 3.5 e 7):
// registro do aparelho, autorização de 12 horas vinculada ao caixa aberto, aparelho revogado,
// caixa fechado e o sinal de conexão. A sessão do Auth.js é simulada nos Route Handlers.
const { authorize } = vi.hoisted(() => ({ authorize: vi.fn() }));
vi.mock("@/lib/authz", () => ({ authorize }));

const { POST } = await import("@/app/api/offline/prepare/route");
const { GET: ping } = await import("@/app/api/offline/ping/route");

let store: Store;
let user: SessionUser;

beforeEach(async () => {
  await resetDatabase();
  store = await seedStore();
  user = { id: store.user.id, name: store.user.name, role: "SELLER" };
  authorize.mockReset();
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function expectRefusal(promise: Promise<unknown>, code: OfflinePrepareError["code"]) {
  const error = await promise.then(
    () => null,
    (err: unknown) => err,
  );
  expect(error).toBeInstanceOf(OfflinePrepareError);
  expect((error as OfflinePrepareError).code).toBe(code);
}

describe("prepareOfflineDevice", () => {
  it("registra o aparelho e emite autorização de 12 horas para o caixa aberto", async () => {
    const now = new Date("2026-10-04T12:00:00.000Z");
    const prep = await prepareOfflineDevice(user, { deviceName: "  Chrome · Windows  " }, now);

    expect(prep.device.name).toBe("Chrome · Windows");
    expect(prep.user).toEqual(user);
    expect(prep.grant.cashRegisterId).toBe(store.cashRegister.id);
    expect(prep.grant.issuedAt).toBe(now.toISOString());
    expect(new Date(prep.grant.expiresAt).getTime() - now.getTime()).toBe(
      OFFLINE_GRANT_HOURS * 60 * 60 * 1000,
    );

    const device = await prisma.offlineDevice.findUniqueOrThrow({ where: { id: prep.device.id } });
    expect(device.registeredById).toBe(user.id);
    expect(device.lastSyncAt?.toISOString()).toBe(now.toISOString());
    expect(await prisma.offlineGrant.count({ where: { deviceId: device.id } })).toBe(1);
  });

  it("reaproveita o aparelho na renovação e com outro operador", async () => {
    const first = await prepareOfflineDevice(user, { deviceName: "Caixa 1" });
    const renewed = await prepareOfflineDevice(user, { deviceId: first.device.id });
    expect(renewed.device.id).toBe(first.device.id);
    expect(renewed.grant.id).not.toBe(first.grant.id);

    // Outro operador no mesmo navegador: mesmo aparelho, autorização própria e caixa próprio
    const other = await createUser("Outra Operadora");
    const otherRegister = await openCashRegister(other.id);
    const otherPrep = await prepareOfflineDevice(
      { id: other.id, name: other.name, role: "SELLER" },
      { deviceId: first.device.id.toUpperCase() },
    );
    expect(otherPrep.device.id).toBe(first.device.id);
    expect(otherPrep.grant.cashRegisterId).toBe(otherRegister.id);

    expect(await prisma.offlineDevice.count()).toBe(1);
    expect(await prisma.offlineGrant.count()).toBe(3);
  });

  it("registra de novo um aparelho desconhecido pelo servidor", async () => {
    const unknown = randomUUID();
    const prep = await prepareOfflineDevice(user, { deviceId: unknown });
    expect(prep.device.id).not.toBe(unknown);
    expect(await prisma.offlineDevice.count()).toBe(1);
  });

  it("recusa caixa fechado, aparelho revogado e id inválido, sem gravar nada", async () => {
    const first = await prepareOfflineDevice(user, {});
    await prisma.offlineDevice.update({
      where: { id: first.device.id },
      data: { revokedAt: new Date(), revokedById: user.id },
    });
    await expectRefusal(
      prepareOfflineDevice(user, { deviceId: first.device.id }),
      "device_revoked",
    );
    await expectRefusal(prepareOfflineDevice(user, { deviceId: "nao-e-uuid" }), "invalid_device");
    await expectRefusal(prepareOfflineDevice(user, { deviceId: 42 }), "invalid_device");

    await prisma.cashRegister.update({
      where: { id: store.cashRegister.id },
      data: { openUserId: null, status: "CLOSED", closedAt: new Date() },
    });
    await expectRefusal(prepareOfflineDevice(user, {}), "cash_closed");

    expect(await prisma.offlineDevice.count()).toBe(1);
    expect(await prisma.offlineGrant.count()).toBe(1);
  });
});

describe("POST /api/offline/prepare", () => {
  const request = (body: unknown, contentType = "application/json") =>
    new Request("http://localhost/api/offline/prepare", {
      method: "POST",
      headers: { "content-type": contentType },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });

  it("sem sessão responde 401 e sem permissão 403, sem gravar nada", async () => {
    authorize.mockResolvedValueOnce({
      ok: false,
      error: "Sessão expirada.",
      code: "unauthenticated",
    });
    const noSession = await POST(request({}));
    expect(noSession.status).toBe(401);
    expect((await noSession.json()).code).toBe("unauthenticated");

    authorize.mockResolvedValueOnce({ ok: false, error: "Sem permissão.", code: "forbidden" });
    const forbidden = await POST(request({}));
    expect(forbidden.status).toBe(403);
    expect(authorize).toHaveBeenCalledWith("pdv.use");
    expect(await prisma.offlineDevice.count()).toBe(0);
  });

  it("prepara sem cache e responde com o código de cada recusa", async () => {
    authorize.mockResolvedValue({ ok: true, user });

    const ok = await POST(request({ deviceName: "Edge · Android" }));
    expect(ok.status).toBe(200);
    expect(ok.headers.get("cache-control")).toBe("no-store");
    const prep = (await ok.json()) as OfflinePreparation;
    expect(prep.device.name).toBe("Edge · Android");

    expect((await POST(request("{", "application/json"))).status).toBe(400);
    expect((await POST(request({}, "text/plain"))).status).toBe(400);

    await prisma.offlineDevice.update({
      where: { id: prep.device.id },
      data: { revokedAt: new Date() },
    });
    const revoked = await POST(request({ deviceId: prep.device.id }));
    expect(revoked.status).toBe(403);
    expect((await revoked.json()).code).toBe("device_revoked");

    await prisma.cashRegister.update({
      where: { id: store.cashRegister.id },
      data: { openUserId: null, status: "CLOSED", closedAt: new Date() },
    });
    const closed = await POST(request({}));
    expect(closed.status).toBe(409);
    expect((await closed.json()).code).toBe("cash_closed");
  });
});

describe("GET /api/offline/ping", () => {
  it("devolve o usuário da sessão sem cache, 401 sem sessão e 403 sem permissão", async () => {
    authorize.mockResolvedValueOnce({ ok: true, user });
    const ok = await ping();
    expect(ok.status).toBe(200);
    expect(ok.headers.get("cache-control")).toBe("no-store");
    expect((await ok.json()).user).toEqual(user);

    authorize.mockResolvedValueOnce({
      ok: false,
      error: "Sessão expirada.",
      code: "unauthenticated",
    });
    expect((await ping()).status).toBe(401);

    authorize.mockResolvedValueOnce({ ok: false, error: "Sem permissão.", code: "forbidden" });
    expect((await ping()).status).toBe(403);
    expect(authorize).toHaveBeenCalledWith("pdv.use");
  });

  it("responde 503 se o banco falhar", async () => {
    authorize.mockRejectedValueOnce(new Error("banco fora do ar"));
    const failed = await ping();
    expect(failed.status).toBe(503);
  });
});
