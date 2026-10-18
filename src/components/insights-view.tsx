"use client";

import { useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  History,
  KeyRound,
  Lightbulb,
  ListChecks,
  Loader2,
  MessageSquareText,
  RefreshCw,
  Sparkles,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import {
  type InsightHistoryItem,
  type InsightRecord,
  type InsightsOverview,
  askInsightQuestion,
  generateInsightReport,
  getInsight,
} from "@/actions/insights";
import type { InsightAlert, InsightItem } from "@/lib/insights/report";
import { MAX_QUESTION_LENGTH } from "@/lib/insights/constants";
import { DateRangePicker, type DayKeyRange } from "@/components/date-range-picker";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatDayKeyBR, formatStoreDateTime } from "@/lib/store-time";
import { cn } from "@/lib/utils";

// Página de insights (issue #113): relatório do período e perguntas livres respondidas pelo
// Claude, com histórico. Todo texto do modelo é exibido como texto simples (sem HTML).

interface InsightsViewProps {
  overview: InsightsOverview;
  initialPeriod: DayKeyRange;
  canConfigure: boolean;
}

type Busy = "report" | "question" | "open" | null;

const usd = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 4,
  maximumFractionDigits: 4,
});

const SEVERITY: Record<
  InsightAlert["gravidade"],
  { label: string; variant: "destructive" | "warning" | "info" }
> = {
  alta: { label: "Alta", variant: "destructive" },
  media: { label: "Média", variant: "warning" },
  baixa: { label: "Baixa", variant: "info" },
};

const periodLabel = (from: string, to: string) =>
  from === to ? formatDayKeyBR(from) : `${formatDayKeyBR(from)} a ${formatDayKeyBR(to)}`;

function NotConfigured({ canConfigure }: { canConfigure: boolean }) {
  return (
    <EmptyState
      fullPage
      icon={KeyRound}
      tone="primary"
      title="Insights ainda não configurados"
      description={
        canConfigure
          ? "Salve a chave da API Anthropic em Configurações para gerar análises dos números da loja."
          : "Peça ao administrador para salvar a chave da API Anthropic em Configurações."
      }
      action={
        canConfigure ? (
          <Link href="/admin/configuracoes" className={buttonVariants()}>
            Ir para Configurações
          </Link>
        ) : undefined
      }
    />
  );
}

function ItemList({
  title,
  icon: Icon,
  items,
  ordered,
  empty,
}: {
  title: string;
  icon: LucideIcon;
  items: (InsightItem | InsightAlert)[];
  ordered?: boolean;
  empty: string;
}) {
  const List = ordered ? "ol" : "ul";
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Icon className="text-primary h-4 w-4" aria-hidden />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-muted-foreground text-sm">{empty}</p>
        ) : (
          <List className="space-y-4">
            {items.map((item, index) => (
              <li key={index} className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  {ordered && (
                    <span className="text-muted-foreground text-sm font-semibold">
                      {index + 1}.
                    </span>
                  )}
                  <span className="font-medium">{item.titulo}</span>
                  {"gravidade" in item && (
                    <Badge variant={SEVERITY[item.gravidade].variant}>
                      {SEVERITY[item.gravidade].label}
                    </Badge>
                  )}
                </div>
                <p className="text-muted-foreground text-sm">{item.explicacao}</p>
                {item.indicador && (
                  <p className="bg-muted inline-block rounded-md px-2 py-0.5 text-xs font-medium">
                    {item.indicador}
                  </p>
                )}
              </li>
            ))}
          </List>
        )}
      </CardContent>
    </Card>
  );
}

function RecordMeta({ record }: { record: InsightRecord | InsightHistoryItem }) {
  return (
    <span className="text-muted-foreground block text-xs">
      {periodLabel(record.periodFrom, record.periodTo)} · por {record.userName} em{" "}
      {formatStoreDateTime(record.createdAt)} · {record.model} ·{" "}
      {(record.inputTokens + record.outputTokens).toLocaleString("pt-BR")} tokens · custo estimado{" "}
      {usd.format(record.costEstimate)}
    </span>
  );
}

function RecordView({ record }: { record: InsightRecord }) {
  if (record.kind === "QUESTION") {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <MessageSquareText className="text-primary h-5 w-5" aria-hidden />
            {record.question}
          </CardTitle>
          <RecordMeta record={record} />
        </CardHeader>
        <CardContent>
          <p className="text-sm whitespace-pre-line">
            {record.answer?.resposta ?? "Não foi possível exibir esta resposta."}
          </p>
        </CardContent>
      </Card>
    );
  }

  const report = record.report;
  if (!report) {
    return <EmptyState title="Não foi possível exibir esta análise." icon={AlertTriangle} />;
  }
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Sparkles className="text-primary h-5 w-5" aria-hidden />
            Resumo do período
          </CardTitle>
          <RecordMeta record={record} />
        </CardHeader>
        <CardContent>
          <p className="whitespace-pre-line">{report.resumo}</p>
        </CardContent>
      </Card>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ItemList
          title="Alertas"
          icon={AlertTriangle}
          items={report.alertas}
          empty="Nenhum alerta."
        />
        <ItemList
          title="Destaques"
          icon={TrendingUp}
          items={report.destaques}
          empty="Nenhum destaque."
        />
        <ItemList
          title="Oportunidades"
          icon={Lightbulb}
          items={report.oportunidades}
          empty="Nenhuma oportunidade apontada."
        />
        <ItemList
          title="Ações sugeridas"
          icon={ListChecks}
          items={report.acoesSugeridas}
          ordered
          empty="Nenhuma ação sugerida."
        />
      </div>
    </div>
  );
}

export function InsightsView({ overview, initialPeriod, canConfigure }: InsightsViewProps) {
  const [period, setPeriod] = useState<DayKeyRange>(initialPeriod);
  const [question, setQuestion] = useState("");
  const [record, setRecord] = useState<InsightRecord | null>(null);
  const [reused, setReused] = useState(false);
  const [history, setHistory] = useState(overview.history);
  const [usedToday, setUsedToday] = useState(overview.usedToday);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);

  if (!overview.configured) return <NotConfigured canConfigure={canConfigure} />;

  const show = (next: InsightRecord, isReused = false) => {
    setRecord(next);
    setReused(isReused);
    setError(null);
    if (!isReused) {
      setHistory((prev) => [next, ...prev.filter((h) => h.id !== next.id)].slice(0, 20));
      setUsedToday((n) => n + 1);
    }
  };

  const generate = async (force = false) => {
    setBusy("report");
    const res = await generateInsightReport({ ...period, force });
    setBusy(null);
    if (res.success) show(res.data, res.reused === true);
    else setError(res.error);
  };

  const ask = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy("question");
    const res = await askInsightQuestion({ ...period, question });
    setBusy(null);
    if (res.success) {
      show(res.data);
      setQuestion("");
    } else {
      setError(res.error);
    }
  };

  const open = async (id: string) => {
    setBusy("open");
    const res = await getInsight(id);
    setBusy(null);
    if (res.success) {
      setRecord(res.data);
      setReused(false);
      setError(null);
    } else {
      setError(res.error);
    }
  };

  const limitReached = usedToday >= overview.dailyLimit;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Insights"
        icon={Sparkles}
        description="Análises dos números da loja feitas pelo Claude: resumo do período, alertas, oportunidades e ações. Confira os números antes de decidir."
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_1fr]">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Análise do período</CardTitle>
            <CardDescription>
              Compara o período com o anterior de mesma duração. Datas no horário da loja.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1">
              <Label
                htmlFor="insights-periodo"
                className="text-muted-foreground text-xs font-medium"
              >
                Período
              </Label>
              <DateRangePicker
                id="insights-periodo"
                from={period.from}
                to={period.to}
                onChange={setPeriod}
              />
            </div>
            <Button
              type="button"
              className="w-full sm:w-auto"
              onClick={() => generate(false)}
              disabled={busy !== null || limitReached}
            >
              {busy === "report" ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <Sparkles className="h-4 w-4" aria-hidden />
              )}
              Gerar análise
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Pergunte sobre o período</CardTitle>
            <CardDescription>
              Ex.: &quot;Quais produtos devo repor primeiro?&quot; ou &quot;Por que o faturamento
              caiu?&quot;
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={ask} className="space-y-2">
              <Label htmlFor="insights-pergunta" className="sr-only">
                Pergunta
              </Label>
              <Textarea
                id="insights-pergunta"
                value={question}
                maxLength={MAX_QUESTION_LENGTH}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="Escreva sua pergunta sobre os números do período"
                aria-describedby="insights-pergunta-contador"
              />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span id="insights-pergunta-contador" className="text-muted-foreground text-xs">
                  {question.length}/{MAX_QUESTION_LENGTH}
                </span>
                <Button
                  type="submit"
                  variant="outline"
                  disabled={busy !== null || limitReached || question.trim().length < 3}
                >
                  {busy === "question" ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  ) : (
                    <MessageSquareText className="h-4 w-4" aria-hidden />
                  )}
                  Perguntar
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>

      <p className="text-muted-foreground text-xs" aria-live="polite">
        {usedToday} de {overview.dailyLimit} análises usadas hoje.
        {limitReached && " Limite do dia atingido: reabra uma análise do histórico."}
      </p>

      <div aria-live="polite" className="space-y-4">
        {(busy === "report" || busy === "question") && (
          <Card>
            <CardContent className="text-muted-foreground flex items-center gap-2 p-6 text-sm">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              Analisando os números da loja. Isso pode levar até um minuto.
            </CardContent>
          </Card>
        )}
        {error && (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}
        {record && busy !== "report" && busy !== "question" && (
          <>
            {reused && (
              <div className="bg-muted flex flex-wrap items-center justify-between gap-2 rounded-lg p-3 text-sm">
                <span>Esta análise do mesmo período foi gerada há menos de 1 hora.</span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => generate(true)}
                  disabled={busy !== null || limitReached}
                >
                  <RefreshCw className="h-4 w-4" aria-hidden />
                  Gerar novamente
                </Button>
              </div>
            )}
            <RecordView record={record} />
          </>
        )}
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <History className="text-primary h-4 w-4" aria-hidden />
            Histórico
          </CardTitle>
          <CardDescription>Reabrir uma análise não gera custo.</CardDescription>
        </CardHeader>
        <CardContent>
          {history.length === 0 ? (
            <p className="text-muted-foreground text-sm">Nenhuma análise gerada ainda.</p>
          ) : (
            <ul className="divide-y">
              {history.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => open(item.id)}
                    disabled={busy !== null}
                    aria-current={record?.id === item.id ? "true" : undefined}
                    className={cn(
                      "hover:bg-muted/60 focus-visible:ring-ring/50 w-full rounded-md px-2 py-3 text-left outline-none focus-visible:ring-3",
                      record?.id === item.id && "bg-muted",
                    )}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={item.kind === "REPORT" ? "secondary" : "outline"}>
                        {item.kind === "REPORT" ? "Análise" : "Pergunta"}
                      </Badge>
                      <span className="text-sm font-medium">
                        {item.kind === "QUESTION" && item.question
                          ? item.question
                          : periodLabel(item.periodFrom, item.periodTo)}
                      </span>
                    </div>
                    <span className="mt-1 block">
                      <RecordMeta record={item} />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
