"use server";

import { BusinessInsightKind, Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { authorize } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { readApiKey } from "@/lib/ai-key";
import { answerQuestion, generateReport } from "@/lib/insights/claude";
import { type InsightAnswer, type InsightReport, InsightReportSchema } from "@/lib/insights/report";
import { MAX_QUESTION_LENGTH } from "@/lib/insights/constants";
import { buildInsightSnapshot } from "@/lib/insights/snapshot";
import { MAX_REPORT_DAYS } from "@/lib/sales-metrics";
import { type CalendarDay, countDays, parseDayKey, startOfStoreDay } from "@/lib/store-time";

// Insights do negócio com o Claude (issue #113), para ADMIN e MANAGER. Cada análise gerada fica
// gravada (BusinessInsight) e pode ser reaberta sem novo custo. A chave da API é lida no servidor
// e nunca sai dele.

/** Gerações (relatórios + perguntas) por dia na loja, no relógio da loja. */
const DAILY_INSIGHT_LIMIT = 30;
/** Relatório do mesmo período mais novo que isto é reaproveitado em vez de gerar outro. */
const REUSE_WINDOW_MS = 60 * 60 * 1000;
const HISTORY_SIZE = 20;

export type InsightKindValue = "REPORT" | "QUESTION";

export interface InsightRecord {
  id: string;
  kind: InsightKindValue;
  periodFrom: string;
  periodTo: string;
  question: string | null;
  report: InsightReport | null;
  answer: InsightAnswer | null;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costEstimate: number;
  userName: string;
  createdAt: string;
}

export type InsightHistoryItem = Omit<InsightRecord, "report" | "answer">;

export interface InsightsOverview {
  configured: boolean;
  history: InsightHistoryItem[];
  usedToday: number;
  dailyLimit: number;
}

type InsightResult =
  { success: true; data: InsightRecord; reused?: boolean } | { success: false; error: string };

const insightSelect = {
  id: true,
  kind: true,
  periodFrom: true,
  periodTo: true,
  question: true,
  content: true,
  model: true,
  inputTokens: true,
  outputTokens: true,
  costEstimate: true,
  createdAt: true,
  user: { select: { name: true } },
} satisfies Prisma.BusinessInsightSelect;

type InsightRow = Prisma.BusinessInsightGetPayload<{ select: typeof insightSelect }>;

function toHistoryItem(row: InsightRow): InsightHistoryItem {
  return {
    id: row.id,
    kind: row.kind,
    periodFrom: row.periodFrom,
    periodTo: row.periodTo,
    question: row.question,
    model: row.model,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    costEstimate: row.costEstimate.toNumber(),
    userName: row.user.name,
    createdAt: row.createdAt.toISOString(),
  };
}

// O conteúdo é revalidado na leitura: um registro antigo ou mexido não quebra a tela
function toRecord(row: InsightRow): InsightRecord {
  const content = row.content as Record<string, unknown> | null;
  const report =
    row.kind === BusinessInsightKind.REPORT ? InsightReportSchema.safeParse(content) : null;
  const answer =
    row.kind === BusinessInsightKind.QUESTION && typeof content?.resposta === "string"
      ? { resposta: content.resposta }
      : null;
  return { ...toHistoryItem(row), report: report?.success ? report.data : null, answer };
}

type PeriodCheck =
  | { ok: true; from: CalendarDay; to: CalendarDay; fromKey: string; toKey: string }
  | { ok: false; error: string };

function checkPeriod(from: unknown, to: unknown): PeriodCheck {
  const fromDay = parseDayKey(from);
  const toDay = parseDayKey(to);
  if (!fromDay || !toDay) return { ok: false, error: "Informe um período válido." };
  const days = countDays(fromDay, toDay);
  if (days < 1) {
    return { ok: false, error: "A data inicial não pode ser posterior à data final." };
  }
  if (days > MAX_REPORT_DAYS) {
    return { ok: false, error: `O período máximo da análise é de ${MAX_REPORT_DAYS} dias.` };
  }
  return { ok: true, from: fromDay, to: toDay, fromKey: from as string, toKey: to as string };
}

const usedToday = () =>
  prisma.businessInsight.count({ where: { createdAt: { gte: startOfStoreDay() } } });

/** Chave da API e limite diário: o que precisa estar certo antes de chamar o Claude. */
async function readyToGenerate(): Promise<
  { ok: true; apiKey: string } | { ok: false; error: string }
> {
  const apiKey = await readApiKey();
  if (!apiKey) {
    return {
      ok: false,
      error:
        "A chave da API Anthropic não está configurada. Peça ao administrador para salvá-la em Configurações.",
    };
  }
  if ((await usedToday()) >= DAILY_INSIGHT_LIMIT) {
    return {
      ok: false,
      error: `Limite de ${DAILY_INSIGHT_LIMIT} análises por dia atingido. Tente de novo amanhã ou reabra uma análise do histórico.`,
    };
  }
  return { ok: true, apiKey };
}

export async function getInsightsOverview(): Promise<InsightsOverview | null> {
  try {
    const authz = await authorize("insights.view");
    if (!authz.ok) return null;

    const [apiKey, rows, used] = await Promise.all([
      prisma.storeSettings.findUnique({
        where: { id: "default" },
        select: { anthropicApiKeyEnc: true },
      }),
      prisma.businessInsight.findMany({
        select: insightSelect,
        orderBy: { createdAt: "desc" },
        take: HISTORY_SIZE,
      }),
      usedToday(),
    ]);
    return {
      configured: Boolean(apiKey?.anthropicApiKeyEnc),
      history: rows.map(toHistoryItem),
      usedToday: used,
      dailyLimit: DAILY_INSIGHT_LIMIT,
    };
  } catch (error) {
    console.error("Erro ao carregar os insights:", error);
    return null;
  }
}

export async function getInsight(id: string): Promise<InsightResult> {
  try {
    const authz = await authorize("insights.view");
    if (!authz.ok) return { success: false, error: authz.error };
    if (typeof id !== "string" || !id) return { success: false, error: "Análise não encontrada." };

    const row = await prisma.businessInsight.findUnique({ where: { id }, select: insightSelect });
    if (!row) return { success: false, error: "Análise não encontrada." };
    return { success: true, data: toRecord(row) };
  } catch (error) {
    console.error("Erro ao abrir a análise:", error);
    return { success: false, error: "Falha ao abrir a análise. Tente novamente." };
  }
}

export async function generateInsightReport(input: {
  from: string;
  to: string;
  force?: boolean;
}): Promise<InsightResult> {
  try {
    const authz = await authorize("insights.view");
    if (!authz.ok) return { success: false, error: authz.error };

    const period = checkPeriod(input?.from, input?.to);
    if (!period.ok) return { success: false, error: period.error };

    // Relatório recente do mesmo período: devolve o salvo (sem custo), salvo se pedir outro
    if (input.force !== true) {
      const recent = await prisma.businessInsight.findFirst({
        where: {
          kind: BusinessInsightKind.REPORT,
          periodFrom: period.fromKey,
          periodTo: period.toKey,
          createdAt: { gte: new Date(Date.now() - REUSE_WINDOW_MS) },
        },
        select: insightSelect,
        orderBy: { createdAt: "desc" },
      });
      if (recent) return { success: true, data: toRecord(recent), reused: true };
    }

    const ready = await readyToGenerate();
    if (!ready.ok) return { success: false, error: ready.error };

    const snapshot = await buildInsightSnapshot(period.from, period.to);
    const result = await generateReport(ready.apiKey, snapshot);
    if (!result.ok) return { success: false, error: result.error };

    const row = await prisma.businessInsight.create({
      data: {
        kind: BusinessInsightKind.REPORT,
        periodFrom: period.fromKey,
        periodTo: period.toKey,
        content: result.data,
        model: result.model,
        inputTokens:
          result.usage.inputTokens +
          result.usage.cacheCreationTokens +
          result.usage.cacheReadTokens,
        outputTokens: result.usage.outputTokens,
        costEstimate: new Prisma.Decimal(result.usage.costEstimate),
        userId: authz.user.id,
      },
      select: insightSelect,
    });
    revalidatePath("/admin/insights");
    return { success: true, data: toRecord(row) };
  } catch (error) {
    console.error("Erro ao gerar a análise:", error);
    return { success: false, error: "Falha ao gerar a análise. Tente novamente." };
  }
}

export async function askInsightQuestion(input: {
  from: string;
  to: string;
  question: string;
}): Promise<InsightResult> {
  try {
    const authz = await authorize("insights.view");
    if (!authz.ok) return { success: false, error: authz.error };

    const period = checkPeriod(input?.from, input?.to);
    if (!period.ok) return { success: false, error: period.error };

    const question = typeof input.question === "string" ? input.question.trim() : "";
    if (question.length < 3) return { success: false, error: "Escreva a pergunta." };
    if (question.length > MAX_QUESTION_LENGTH) {
      return {
        success: false,
        error: `A pergunta pode ter até ${MAX_QUESTION_LENGTH} caracteres.`,
      };
    }

    const ready = await readyToGenerate();
    if (!ready.ok) return { success: false, error: ready.error };

    const snapshot = await buildInsightSnapshot(period.from, period.to);
    const result = await answerQuestion(ready.apiKey, snapshot, question);
    if (!result.ok) return { success: false, error: result.error };

    const row = await prisma.businessInsight.create({
      data: {
        kind: BusinessInsightKind.QUESTION,
        periodFrom: period.fromKey,
        periodTo: period.toKey,
        question,
        content: { resposta: result.data.resposta },
        model: result.model,
        inputTokens:
          result.usage.inputTokens +
          result.usage.cacheCreationTokens +
          result.usage.cacheReadTokens,
        outputTokens: result.usage.outputTokens,
        costEstimate: new Prisma.Decimal(result.usage.costEstimate),
        userId: authz.user.id,
      },
      select: insightSelect,
    });
    revalidatePath("/admin/insights");
    return { success: true, data: toRecord(row) };
  } catch (error) {
    console.error("Erro ao responder a pergunta:", error);
    return { success: false, error: "Falha ao responder a pergunta. Tente novamente." };
  }
}
