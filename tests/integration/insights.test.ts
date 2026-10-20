import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PaymentMethod, Prisma, Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { can, type AppRole, type Permission } from "@/lib/permissions";
import { createUser, resetDatabase, seedStore, type Store } from "./fixtures";

// Insights com o Claude (issue #113): retrato de dados, actions da página e chave da API. O Claude
// é simulado; a sessão do Auth.js também, com a matriz de permissões real.
const { authorize, claude } = vi.hoisted(() => ({
  authorize: vi.fn(),
  claude: { generateReport: vi.fn(), answerQuestion: vi.fn(), testApiKey: vi.fn() },
}));
vi.mock("@/lib/authz", () => ({ authorize }));
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  unstable_cache: (fn: unknown) => fn,
}));
vi.mock("@/lib/insights/claude", () => claude);

const { buildInsightSnapshot } = await import("@/lib/insights/snapshot");
const {
  askInsightQuestion,
  generateInsightReport,
  getDashboardInsight,
  getInsight,
  getInsightsOverview,
} = await import("@/actions/insights");
const { getAiKeyStatus, removeAnthropicApiKey, saveAnthropicApiKey, testAnthropicApiKey } =
  await import("@/actions/ai-settings");
const { getStoreSettings } = await import("@/actions/settings");
const { isAiInsightsConfigured } = await import("@/lib/ai-key");

const API_KEY = `sk-ant-api03-${"k".repeat(40)}wxyz`;
const OCT = { from: { year: 2026, month: 10, day: 1 }, to: { year: 2026, month: 10, day: 31 } };
const usage = {
  inputTokens: 1200,
  outputTokens: 400,
  cacheCreationTokens: 0,
  cacheReadTokens: 0,
  costEstimate: 0.00032,
};
const report = {
  resumo: "Faturamento subiu 25,0%.",
  destaques: [{ titulo: "Ticket médio", explicacao: "Subiu.", indicador: "R$ 100,00" }],
  alertas: [],
  oportunidades: [],
  acoesSugeridas: [],
};

let store: Store;

function loginAs(id: string, role: AppRole) {
  authorize.mockImplementation(async (permission?: Permission) =>
    !permission || can(role, permission)
      ? { ok: true, user: { id, name: "Sessão", role } }
      : { ok: false, error: "Acesso negado.", code: "forbidden" },
  );
}

async function sale(
  total: number,
  occurredAt: string,
  extra: Partial<Prisma.SaleUncheckedCreateInput> = {},
) {
  return prisma.sale.create({
    data: {
      total: new Prisma.Decimal(total),
      paymentMethod: PaymentMethod.PIX,
      userId: store.user.id,
      occurredAt: new Date(occurredAt),
      ...extra,
    },
  });
}

async function admin() {
  const user = await prisma.user.create({
    data: { name: "Administradora", email: "admin@teste.local", password: "x", role: Role.ADMIN },
  });
  loginAs(user.id, "ADMIN");
  return user;
}

beforeEach(async () => {
  await resetDatabase();
  store = await seedStore();
  claude.generateReport.mockReset();
  claude.answerQuestion.mockReset();
  claude.testApiKey.mockReset();
  claude.generateReport.mockResolvedValue({
    ok: true,
    data: report,
    usage,
    model: "claude-haiku-5-5",
  });
  claude.answerQuestion.mockResolvedValue({
    ok: true,
    data: { resposta: "Reponha o arroz." },
    usage,
    model: "claude-haiku-5-5",
  });
  claude.testApiKey.mockResolvedValue({ ok: true });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("retrato de dados", () => {
  it("compara com o período anterior e deixa estornos e pedidos fora do faturamento", async () => {
    // Outubro: R$ 10.000 em 100 vendas (ticket R$ 100); setembro (30 dias antes): R$ 8.000
    for (let i = 0; i < 100; i++)
      await sale(100, `2026-10-${String((i % 28) + 1).padStart(2, "0")}T15:00:00Z`);
    for (let i = 0; i < 80; i++)
      await sale(100, `2026-09-${String((i % 28) + 2).padStart(2, "0")}T15:00:00Z`);
    await sale(500, "2026-10-10T15:00:00Z", { reversedAt: new Date("2026-10-10T16:00:00Z") });
    await prisma.catalogOrder.create({
      data: {
        requestKey: "0f8fad5b-d9cb-469f-a165-70867728950e",
        payloadHash: "h",
        createdById: store.user.id,
        customerName: "Fulana Pedido",
        customerPhone: "11988887777",
        estimatedTotal: new Prisma.Decimal(300),
        createdAt: new Date("2026-10-05T12:00:00Z"),
      },
    });

    const snapshot = await buildInsightSnapshot(OCT.from, OCT.to, new Date("2026-10-31T20:00:00Z"));
    expect(snapshot.periodoAnterior).toEqual({ de: "2026-08-31", ate: "2026-09-30" });
    expect(snapshot.vendas.periodo).toMatchObject({
      faturamento: 10000,
      vendas: 100,
      ticketMedio: 100,
    });
    expect(snapshot.vendas.periodoAnterior.faturamento).toBe(8000);
    expect(snapshot.vendas.variacaoPct.faturamento).toBe(25);
    expect(snapshot.vendas.estornos).toEqual({ quantidade: 1, valor: 500 });
    expect(snapshot.pedidosCatalogo).toMatchObject({
      recebidos: 1,
      emAberto: 1,
      convertidosEmVenda: 0,
    });
    expect(snapshot.serie).toHaveLength(31);
    expect(snapshot.porHora).toEqual([{ hora: 12, faturamento: 10000, vendas: 100 }]);
  });

  it("não leva nome, telefone nem documento de cliente, nem dados do operador", async () => {
    await prisma.customer.update({
      where: { id: store.customer.id },
      data: { name: "Maria Cliente Secreta", phone: "11977776666", document: "12345678909" },
    });
    await sale(42.95, "2026-10-03T13:00:00Z", { customerId: store.customer.id });

    const json = JSON.stringify(await buildInsightSnapshot(OCT.from, OCT.to));
    for (const secret of [
      "Maria Cliente Secreta",
      "11977776666",
      "12345678909",
      store.user.name,
      store.user.email,
    ]) {
      expect(json).not.toContain(secret);
    }
    // Produtos parados aparecem pelo nome, com o valor a custo
    expect(json).toContain("Arroz 5kg");
  });
});

describe("chave da API", () => {
  it("o ADMIN salva; o banco e as telas só veem a versão cifrada e o final", async () => {
    await admin();
    const res = await saveAnthropicApiKey(`  ${API_KEY}  `);
    expect(res).toMatchObject({
      success: true,
      status: { configured: true, hint: "wxyz", readable: true },
    });
    expect(claude.testApiKey).toHaveBeenCalledWith(API_KEY);

    const row = await prisma.storeSettings.findUniqueOrThrow({ where: { id: "default" } });
    expect(row.anthropicApiKeyEnc).not.toContain(API_KEY);
    expect(JSON.stringify(await getStoreSettings())).not.toContain("anthropic");
    expect(JSON.stringify(await getAiKeyStatus())).not.toContain(API_KEY);
    expect(await isAiInsightsConfigured()).toBe(true);

    claude.testApiKey.mockResolvedValue({ ok: true });
    expect(await testAnthropicApiKey()).toEqual({ success: true });
    expect(claude.testApiKey).toHaveBeenLastCalledWith(API_KEY);
  });

  it("chave recusada não é salva; falha passageira salva com aviso", async () => {
    await admin();
    claude.testApiKey.mockResolvedValueOnce({
      ok: false,
      error: "Chave recusada.",
      retryable: false,
    });
    expect(await saveAnthropicApiKey(API_KEY)).toEqual({
      success: false,
      error: "Chave recusada.",
    });
    expect((await getAiKeyStatus())?.configured).toBe(false);

    claude.testApiKey.mockResolvedValueOnce({ ok: false, error: "Sem conexão.", retryable: true });
    const saved = await saveAnthropicApiKey(API_KEY);
    expect(saved).toMatchObject({
      success: true,
      warning: expect.stringContaining("Sem conexão."),
    });

    expect(await removeAnthropicApiKey()).toMatchObject({ success: true });
    expect((await getAiKeyStatus())?.configured).toBe(false);
    expect(await isAiInsightsConfigured()).toBe(false);
  });

  it("formato inválido e perfis sem settings.manage são recusados", async () => {
    await admin();
    expect(await saveAnthropicApiKey("sk-proj-abc")).toMatchObject({ success: false });
    expect(claude.testApiKey).not.toHaveBeenCalled();

    const manager = await createUser("Gerente");
    loginAs(manager.id, "MANAGER");
    expect(await saveAnthropicApiKey(API_KEY)).toEqual({ success: false, error: "Acesso negado." });
    expect(await removeAnthropicApiKey()).toEqual({ success: false, error: "Acesso negado." });
    expect(await getAiKeyStatus()).toBeNull();
  });
});

describe("actions da página", () => {
  async function configured(role: AppRole = "MANAGER") {
    await admin();
    await saveAnthropicApiKey(API_KEY);
    const user = await createUser(role === "MANAGER" ? "Gerente" : "Vendedor");
    loginAs(user.id, role);
    return user;
  }

  it("o vendedor não acessa nenhuma action", async () => {
    await configured("SELLER");
    expect(await getInsightsOverview()).toBeNull();
    expect(await generateInsightReport({ from: "2026-10-01", to: "2026-10-31" })).toMatchObject({
      success: false,
    });
    expect(
      await askInsightQuestion({ from: "2026-10-01", to: "2026-10-31", question: "Como foi?" }),
    ).toMatchObject({ success: false });
    expect(claude.generateReport).not.toHaveBeenCalled();
  });

  it("sem chave, avisa e não chama o Claude", async () => {
    const manager = await createUser("Gerente");
    loginAs(manager.id, "MANAGER");
    expect((await getInsightsOverview())?.configured).toBe(false);
    const res = await generateInsightReport({ from: "2026-10-01", to: "2026-10-31" });
    expect(res).toMatchObject({
      success: false,
      error: expect.stringContaining("não está configurada"),
    });
    expect(claude.generateReport).not.toHaveBeenCalled();
  });

  it("grava o relatório, reaproveita o recente e gera de novo quando pedido", async () => {
    const manager = await configured();
    const first = await generateInsightReport({ from: "2026-10-01", to: "2026-10-31" });
    expect(first).toMatchObject({ success: true, data: { kind: "REPORT", report } });
    expect(claude.generateReport).toHaveBeenCalledWith(
      API_KEY,
      expect.objectContaining({ periodo: expect.any(Object) }),
    );

    const again = await generateInsightReport({ from: "2026-10-01", to: "2026-10-31" });
    expect(again).toMatchObject({ success: true, reused: true });
    expect(claude.generateReport).toHaveBeenCalledTimes(1);

    await generateInsightReport({ from: "2026-10-01", to: "2026-10-31", force: true });
    expect(claude.generateReport).toHaveBeenCalledTimes(2);

    const saved = await prisma.businessInsight.findMany();
    expect(saved).toHaveLength(2);
    expect(saved[0]).toMatchObject({
      model: "claude-haiku-5-5",
      inputTokens: 1200,
      outputTokens: 400,
      userId: manager.id,
    });
    expect(saved[0].costEstimate.toString()).toBe("0.00032");

    // Reabrir pelo histórico não chama o Claude
    if (!first.success) throw new Error("relatório não gerado");
    expect(await getInsight(first.data.id)).toMatchObject({ success: true, data: { report } });
    expect(claude.generateReport).toHaveBeenCalledTimes(2);
    expect((await getInsightsOverview())?.history).toHaveLength(2);
  });

  it("responde pergunta, valida tamanho e período", async () => {
    await configured();
    const ok = await askInsightQuestion({
      from: "2026-10-01",
      to: "2026-10-31",
      question: "  O que repor?  ",
    });
    expect(ok).toMatchObject({
      success: true,
      data: {
        kind: "QUESTION",
        question: "O que repor?",
        answer: { resposta: "Reponha o arroz." },
      },
    });
    expect(claude.answerQuestion).toHaveBeenCalledWith(API_KEY, expect.any(Object), "O que repor?");

    expect(
      await askInsightQuestion({ from: "2026-10-01", to: "2026-10-31", question: "x".repeat(501) }),
    ).toMatchObject({ success: false });
    expect(
      await askInsightQuestion({ from: "2026-10-31", to: "2026-10-01", question: "Como foi?" }),
    ).toMatchObject({ success: false });
    expect(await generateInsightReport({ from: "2025-01-01", to: "2026-10-31" })).toMatchObject({
      success: false,
      error: expect.stringContaining("366"),
    });
  });

  it("erro do Claude não grava nada e o limite diário bloqueia novas análises", async () => {
    const manager = await configured();
    claude.generateReport.mockResolvedValueOnce({
      ok: false,
      error: "O Claude recusou gerar esta análise.",
    });
    expect(await generateInsightReport({ from: "2026-10-01", to: "2026-10-31" })).toEqual({
      success: false,
      error: "O Claude recusou gerar esta análise.",
    });
    expect(await prisma.businessInsight.count()).toBe(0);

    await prisma.businessInsight.createMany({
      data: Array.from({ length: 30 }, () => ({
        kind: "QUESTION" as const,
        periodFrom: "2026-10-01",
        periodTo: "2026-10-31",
        question: "?",
        content: { resposta: "!" },
        model: "claude-haiku-5-5",
        inputTokens: 1,
        outputTokens: 1,
        costEstimate: new Prisma.Decimal(0),
        userId: manager.id,
      })),
    });
    const blocked = await askInsightQuestion({
      from: "2026-10-01",
      to: "2026-10-31",
      question: "Como foi?",
    });
    expect(blocked).toMatchObject({
      success: false,
      error: expect.stringContaining("Limite de 30"),
    });
    expect(claude.answerQuestion).not.toHaveBeenCalled();
  });
});

describe("insights no Dashboard", () => {
  it("mostra os alertas mais graves e as primeiras ações do último relatório, sem chamar o Claude", async () => {
    await admin();
    await saveAnthropicApiKey(API_KEY);
    const manager = await createUser("Gerente");
    loginAs(manager.id, "MANAGER");
    expect(await getDashboardInsight()).toEqual({ configured: true, latest: null });

    const a = (titulo: string, gravidade: "alta" | "media" | "baixa") => ({
      titulo,
      explicacao: "x",
      indicador: "y",
      gravidade,
    });
    claude.generateReport.mockResolvedValueOnce({
      ok: true,
      data: {
        ...report,
        alertas: [
          a("Baixa", "baixa"),
          a("Média", "media"),
          a("Alta", "alta"),
          a("Outra alta", "alta"),
        ],
        acoesSugeridas: [1, 2, 3].map((n) => ({
          titulo: `Ação ${n}`,
          explicacao: "x",
          indicador: "y",
        })),
      },
      usage,
      model: "claude-haiku-5-5",
    });
    await generateInsightReport({ from: "2026-10-01", to: "2026-10-31" });
    await askInsightQuestion({ from: "2026-10-01", to: "2026-10-31", question: "Como foi?" });
    const calls = claude.generateReport.mock.calls.length;

    const insight = await getDashboardInsight();
    expect(insight?.latest?.alertas.map((x) => x.titulo)).toEqual(["Alta", "Outra alta", "Média"]);
    expect(insight?.latest?.acoes.map((x) => x.titulo)).toEqual(["Ação 1", "Ação 2"]);
    expect(claude.generateReport).toHaveBeenCalledTimes(calls);

    const seller = await createUser("Vendedor");
    loginAs(seller.id, "SELLER");
    expect(await getDashboardInsight()).toBeNull();
  });
});
