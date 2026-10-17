"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlertTriangle,
  DatabaseZap,
  FlaskConical,
  History,
  Loader2,
  RefreshCw,
  RotateCcw,
  Trash2,
} from "lucide-react";
import {
  generateTestDataAction,
  removeTestDataAction,
  type GenerateTestDataResponse,
  type RemoveTestDataResponse,
  type ResetStoreDataResponse,
  type TestDataOverview,
} from "@/actions/test-data";
import type {
  CleanupCounts,
  GeneratedActiveCounts,
  ResetBlockers,
  TestDataRunItem,
} from "@/lib/test-data";
import {
  TEST_DATA_ENTITIES,
  validateTestDataCounts,
  type TestDataCounts,
  type TestDataEntity,
} from "@/lib/test-data-generator";
import { ResetStoreDialog } from "@/components/reset-store-dialog";
import { useConfirm } from "@/components/confirm-dialog";
import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatDateTime } from "@/lib/dates";
import { newOperationId } from "@/lib/operation-id";
import { cn } from "@/lib/utils";

// Seção "Dados de teste" em Configurações (issue #57), só para ADMIN: gera dados sintéticos, remove
// só os gerados (issue #67) e restaura o banco com confirmação forte. Só aparece com
// ENABLE_STORE_TEST_TOOLS=true. As regras ficam no servidor (src/lib/test-data.ts).

const ENTITY_LABELS: Record<TestDataEntity, string> = {
  categories: "Categorias",
  products: "Produtos",
  customers: "Clientes",
  suppliers: "Fornecedores",
};

// Resumo das contagens gravadas no histórico (geração e restauração), em ordem de interesse
const COUNT_LABELS: [key: string, singular: string, plural: string][] = [
  ["Sale", "venda", "vendas"],
  ["categories", "categoria", "categorias"],
  ["Category", "categoria", "categorias"],
  ["products", "produto", "produtos"],
  ["Product", "produto", "produtos"],
  ["customers", "cliente", "clientes"],
  ["Customer", "cliente", "clientes"],
  ["suppliers", "fornecedor", "fornecedores"],
  ["Supplier", "fornecedor", "fornecedores"],
  ["StockMovement", "movimentação de estoque", "movimentações de estoque"],
  ["CashRegister", "caixa", "caixas"],
  ["Receivable", "título do fiado", "títulos do fiado"],
  ["OfflineDevice", "aparelho", "aparelhos"],
];

function plural(count: number, singular: string, pluralForm: string) {
  return `${count.toLocaleString("pt-BR")} ${count === 1 ? singular : pluralForm}`;
}

function describeCounts(counts: Record<string, number> | null) {
  if (!counts) return null;
  const parts = COUNT_LABELS.filter(([key]) => (counts[key] ?? 0) > 0).map(([key, s, p]) =>
    plural(counts[key], s, p),
  );
  return parts.length > 0 ? parts.join(", ") : "nenhum registro";
}

/** Gerados que ficaram por estarem em uso por dados reais. */
function describeKept(counts: Partial<CleanupCounts>) {
  const parts = [
    plural(counts.keptCategories ?? 0, "categoria com produto real", "categorias com produto real"),
    plural(
      counts.keptCustomers ?? 0,
      "cliente com Fiado em aberto",
      "clientes com Fiado em aberto",
    ),
    plural(
      counts.keptSuppliers ?? 0,
      "fornecedor com entrada real",
      "fornecedores com entrada real",
    ),
  ].filter((part) => !part.startsWith("0 "));
  return parts.length > 0 ? ` Mantidos por uso: ${parts.join(", ")}.` : "";
}

function describeCleanup(counts: Partial<CleanupCounts>) {
  return `Removidos: ${describeCounts(counts as Record<string, number>)}.${describeKept(counts)}`;
}

function describeRun(run: TestDataRunItem) {
  if (run.status === "FAILED") return "Erro inesperado; nada foi alterado.";
  if (run.status === "REJECTED") return run.message ?? "Recusada.";
  if (run.kind === "CLEANUP") return describeCleanup(run.counts ?? {});
  if (run.kind === "RESET") {
    // O total inclui tabelas de apoio (itens de venda, preços históricos...) fora do resumo
    const total = Object.values(run.counts ?? {}).reduce((sum, n) => sum + n, 0);
    if (total === 0) return "Nada a apagar: o banco já estava vazio.";
    return `${plural(total, "registro apagado", "registros apagados")}, entre eles: ${describeCounts(run.counts)}.`;
  }
  return `Criados: ${describeCounts(run.counts)}`;
}

const KIND_LABELS = {
  GENERATE: "Geração",
  CLEANUP: "Remoção dos dados gerados",
  RESET: "Restauração",
} as const;

const STATUS_BADGES = {
  COMPLETED: { label: "Concluída", variant: "success" },
  REJECTED: { label: "Recusada", variant: "warning" },
  FAILED: { label: "Falhou", variant: "destructive" },
} as const;

interface TestDataPanelProps {
  overview: TestDataOverview | null;
}

export function TestDataPanel({ overview }: TestDataPanelProps) {
  if (!overview) {
    return (
      <EmptyState
        icon={DatabaseZap}
        tone="destructive"
        title="Não foi possível carregar os dados de teste"
        description="Recarregue a página em instantes."
      />
    );
  }

  return (
    <section aria-labelledby="test-data-heading" className="max-w-4xl space-y-6">
      <div className="space-y-1">
        <h2 id="test-data-heading" className="text-lg font-semibold">
          Dados de teste
        </h2>
        <p className="text-muted-foreground text-sm">
          Para demonstração e treinamento. Visível só para administradores e exige conexão com o
          servidor.
        </p>
      </div>
      <GenerateCard limits={overview.limits} defaults={overview.defaults} />
      <CleanupCard generated={overview.generated} />
      <ResetCard blockers={overview.blockers} tradeName={overview.tradeName} />
      <RunHistory runs={overview.runs} />
    </section>
  );
}

function GenerateCard({ limits, defaults }: { limits: TestDataCounts; defaults: TestDataCounts }) {
  const [values, setValues] = useState<Record<TestDataEntity, string>>(
    () =>
      Object.fromEntries(TEST_DATA_ENTITIES.map((e) => [e, String(defaults[e])])) as Record<
        TestDataEntity,
        string
      >,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Mantido enquanto não houver resposta: repetir depois de uma resposta perdida não duplica
  const requestId = useRef<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    const counts = Object.fromEntries(
      TEST_DATA_ENTITIES.map((entity) => [
        entity,
        values[entity].trim() === "" ? NaN : Number(values[entity]),
      ]),
    );
    const validation = validateTestDataCounts(counts);
    if (!validation.ok) {
      setError(validation.error);
      return;
    }

    requestId.current ??= newOperationId();
    setLoading(true);
    setError(null);
    let response: GenerateTestDataResponse;
    try {
      response = await generateTestDataAction({
        requestId: requestId.current,
        counts: validation.counts,
      });
    } catch {
      setLoading(false);
      setError("Sem resposta do servidor. Confira a conexão e tente de novo.");
      return;
    }
    setLoading(false);
    requestId.current = null;

    if (!response.success) {
      setError(response.error);
      return;
    }
    toast.success(`Dados de teste gerados: ${describeCounts({ ...response.data.counts })}.`);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <FlaskConical className="text-primary h-5 w-5" />
          Gerar dados de teste
        </CardTitle>
        <CardDescription>
          Cria categorias, produtos com estoque inicial, clientes e fornecedores fictícios, sem
          alterar os cadastros existentes. Os produtos ficam fora do catálogo público, e o estoque
          inicial entra como compra de um fornecedor gerado. Clientes e fornecedores não recebem
          CPF/CNPJ. Os registros ficam marcados e podem ser removidos depois sem afetar os reais.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {TEST_DATA_ENTITIES.map((entity) => (
              <div key={entity} className="space-y-1">
                <Label htmlFor={`test-data-${entity}`} className="text-xs font-medium">
                  {ENTITY_LABELS[entity]}
                </Label>
                <Input
                  id={`test-data-${entity}`}
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={limits[entity]}
                  step={1}
                  value={values[entity]}
                  onChange={(e) => setValues((prev) => ({ ...prev, [entity]: e.target.value }))}
                  aria-describedby={`test-data-${entity}-max`}
                  disabled={loading}
                />
                <p id={`test-data-${entity}-max`} className="text-muted-foreground text-xs">
                  máx. {limits[entity]}
                </p>
              </div>
            ))}
          </div>

          {error && (
            <div
              role="alert"
              className="text-destructive bg-destructive/10 border-destructive/20 rounded-md border p-2.5 text-xs"
            >
              {error}
            </div>
          )}

          <div className="flex justify-end">
            <Button type="submit" disabled={loading} className="w-full sm:w-auto">
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Gerando...
                </>
              ) : (
                <>
                  <FlaskConical className="mr-2 h-4 w-4" /> Gerar dados
                </>
              )}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function CleanupCard({ generated }: { generated: GeneratedActiveCounts }) {
  const router = useRouter();
  const [askConfirm, confirmDialog] = useConfirm();
  const [loading, setLoading] = useState(false);
  // Mantido enquanto não houver resposta: repetir depois de uma resposta perdida não remove de novo
  const requestId = useRef<string | null>(null);
  const total = Object.values(generated).reduce((sum, n) => sum + n, 0);
  const summary = describeCounts({
    products: generated.products,
    categories: generated.categories,
    customers: generated.customers,
    suppliers: generated.suppliers,
  });

  const handleRemove = async () => {
    if (loading) return;
    const ok = await askConfirm({
      title: "Remover os dados gerados?",
      description:
        "Saem só os registros criados por esta seção. Vendas, títulos e cadastros reais continuam como estão; produto, categoria e cliente gerados que ainda estiverem em uso ficam.",
      confirmLabel: "Remover",
      destructive: true,
    });
    if (!ok) return;

    requestId.current ??= newOperationId();
    setLoading(true);
    let response: RemoveTestDataResponse;
    try {
      response = await removeTestDataAction({ requestId: requestId.current });
    } catch {
      setLoading(false);
      toast.error("Sem resposta do servidor. Confira a conexão e tente de novo.");
      return;
    }
    setLoading(false);
    requestId.current = null;

    if (!response.success) {
      toast.error(response.error);
      router.refresh();
    } else {
      toast.success(describeCleanup(response.data.counts));
    }
  };

  return (
    <Card>
      {confirmDialog}
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Trash2 className="text-primary h-5 w-5" />
          Remover dados gerados
        </CardTitle>
        <CardDescription>
          Remove só o que foi criado em &quot;Gerar dados de teste&quot;, sem tocar nos dados reais.
          Produtos, categorias e clientes saem como na exclusão manual (os aparelhos do PDV recebem
          a exclusão na próxima sincronização).
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm sm:flex-row sm:items-center sm:justify-between">
        <p className="text-muted-foreground">
          {total === 0 ? "Nenhum registro gerado ativo." : `Ativos agora: ${summary}.`}
        </p>
        <Button
          type="button"
          variant="outline"
          onClick={handleRemove}
          disabled={loading || total === 0}
          className="w-full sm:w-auto"
        >
          {loading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Removendo...
            </>
          ) : (
            <>
              <Trash2 className="mr-2 h-4 w-4" /> Remover dados gerados
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}

function ResetCard({ blockers, tradeName }: { blockers: ResetBlockers; tradeName: string | null }) {
  const router = useRouter();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogKey, setDialogKey] = useState(0);
  const blocked = blockers.openCashRegisters.length > 0 || blockers.pendingDevices.length > 0;

  const openDialog = () => {
    setDialogKey((key) => key + 1);
    setDialogOpen(true);
  };

  const handleDone = (response: ResetStoreDataResponse) => {
    setDialogOpen(false);
    if (response.success) {
      const total = Object.values(response.data.counts).reduce((sum, n) => sum + n, 0);
      toast.success(
        `Banco restaurado: ${plural(total, "registro apagado", "registros apagados")}.`,
      );
    } else {
      toast.error(response.error);
      router.refresh();
    }
  };

  return (
    <Card className="border-destructive/40">
      <CardHeader>
        <CardTitle className="text-destructive flex items-center gap-2 text-lg">
          <RotateCcw className="h-5 w-5" />
          Restaurar banco
        </CardTitle>
        <CardDescription>
          Volta o sistema ao estado inicial. A ação é irreversível e vale para todos os usuários.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <p className="font-medium">Apaga</p>
            <p className="text-muted-foreground">
              Vendas, caixas e seus movimentos, fiado e recebimentos, estoque e movimentações,
              produtos, categorias, clientes, fornecedores, aparelhos e operações offline.
            </p>
          </div>
          <div className="space-y-1">
            <p className="font-medium">Mantém</p>
            <p className="text-muted-foreground">
              Usuários e senhas, configurações da loja e o histórico desta seção.
            </p>
          </div>
        </div>
        <ul className="text-muted-foreground list-disc space-y-1 pl-5">
          <li>A numeração das vendas volta a 1.</li>
          <li>
            Os aparelhos do PDV sem internet precisam ser preparados de novo. Venda guardada num
            aparelho que não avisou o servidor volta como conflito na conciliação.
          </li>
          <li>
            Em produção, crie antes um ponto de restauração do banco no provedor (Neon), pois o
            sistema não guarda cópia.
          </li>
        </ul>

        {!tradeName ? (
          <p className="bg-muted rounded-md p-3">
            Salve o nome fantasia da loja nas configurações acima antes de restaurar: ele é pedido
            na confirmação.
          </p>
        ) : blocked ? (
          <BlockerList blockers={blockers} onRefresh={() => router.refresh()} />
        ) : (
          <div className="flex justify-end">
            <Button
              type="button"
              variant="destructive"
              onClick={openDialog}
              className="w-full sm:w-auto"
            >
              <RotateCcw className="mr-2 h-4 w-4" /> Restaurar banco…
            </Button>
          </div>
        )}
      </CardContent>

      {tradeName && (
        <ResetStoreDialog
          key={dialogKey}
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          tradeName={tradeName}
          onDone={handleDone}
        />
      )}
    </Card>
  );
}

function BlockerList({ blockers, onRefresh }: { blockers: ResetBlockers; onRefresh: () => void }) {
  return (
    <div role="status" className="border-warning/40 bg-warning/10 space-y-3 rounded-md border p-3">
      <p className="flex items-center gap-2 font-medium">
        <AlertTriangle className="text-warning h-4 w-4 shrink-0" />
        Resolva antes de restaurar
      </p>
      <ul className="space-y-1">
        {blockers.openCashRegisters.map((register) => (
          <li key={register.id}>
            Caixa aberto de <span className="font-medium">{register.userName}</span> desde{" "}
            {formatDateTime(register.openedAt)}: feche o caixa.
          </li>
        ))}
        {blockers.pendingDevices.map((device) => (
          <li key={device.deviceId}>
            Aparelho <span className="font-medium">{device.deviceName}</span> ({device.userName})
            com {plural(device.pending, "venda não enviada", "vendas não enviadas")}: conecte o
            aparelho e sincronize.
          </li>
        ))}
      </ul>
      <Button type="button" variant="outline" size="sm" onClick={onRefresh}>
        <RefreshCw className="mr-2 h-4 w-4" /> Conferir de novo
      </Button>
    </div>
  );
}

function RunHistory({ runs }: { runs: TestDataRunItem[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <History className="text-primary h-5 w-5" />
          Histórico
        </CardTitle>
        <CardDescription>
          Últimas gerações, remoções e restaurações, inclusive as recusadas.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {runs.length === 0 ? (
          <p className="text-muted-foreground text-sm">Nenhuma execução até agora.</p>
        ) : (
          <ul className="divide-y" aria-label="Histórico de execuções">
            {runs.map((run) => {
              const badge = STATUS_BADGES[run.status];
              return (
                <li key={run.id} className="flex flex-col gap-1 py-3 text-sm first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{KIND_LABELS[run.kind]}</span>
                    <Badge variant={badge.variant}>{badge.label}</Badge>
                    <span className="text-muted-foreground text-xs">
                      {formatDateTime(run.createdAt)} · {run.userName}
                    </span>
                  </div>
                  <p
                    className={cn(
                      "text-muted-foreground break-words",
                      run.status !== "COMPLETED" && "text-xs",
                    )}
                  >
                    {describeRun(run)}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
