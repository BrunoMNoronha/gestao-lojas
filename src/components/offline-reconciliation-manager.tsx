"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Ban,
  Check,
  ClipboardCheck,
  History,
  Loader2,
  RefreshCw,
  ShieldX,
  Smartphone,
  TriangleAlert,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  acknowledgeReconciliationIssue,
  approveOfflineConflict,
  discardOfflineConflict,
  listOfflineConflicts,
  listReconciliationIssues,
  revokeOfflineDevice,
  type OfflineConflictItem,
  type OfflineDeviceItem,
  type ReconciliationIssueItem,
} from "@/actions/offline-reconciliation";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { useConfirm } from "@/components/confirm-dialog";
import { PAYMENT_METHOD_LABELS } from "@/lib/payments";
import { formatStoreDateTime } from "@/lib/store-time";
import { cn, formatCurrency, formatNumber } from "@/lib/utils";

// Tela de conciliação das vendas feitas sem internet (issue #38, docs/OFFLINE.md seção 4).
// Conflito: a venda não foi aplicada; o gerente aprova (grava com a autoria e o caixa originais)
// ou descarta com motivo. Pendência: a venda foi aplicada e pede conferência (ciência com nota).
// Aparelhos: os navegadores preparados, com revogação.

const NOTE_MIN = 3;
const NOTE_MAX = 500;

const CONFLICT_REASONS: Record<string, string> = {
  DEVICE_REVOKED: "Aparelho revogado",
  GRANT_MISMATCH: "Autorização não confere",
  CASH_REGISTER_MISMATCH: "Caixa não confere",
  PRICE_NOT_VALID: "Preço fora do período",
  PRODUCT_NOT_FOUND: "Produto inexistente",
  CUSTOMER_NOT_FOUND: "Cliente inexistente",
  FRACTIONAL_QUANTITY: "Quantidade fracionada",
  ON_ACCOUNT_OFFLINE: "Fiado sem internet",
  INVALID_AMOUNTS: "Valores inconsistentes",
  ASSISTED_SUBMISSION: "Enviada pelo gerente",
};

// Não têm como ser gravadas: só o descarte resolve (o servidor recusa a aprovação)
const DISCARD_ONLY = new Set(["PRODUCT_NOT_FOUND", "CUSTOMER_NOT_FOUND", "INVALID_AMOUNTS"]);

const ISSUE_TYPES: Record<string, string> = {
  NEGATIVE_STOCK: "Estoque negativo",
  POST_CLOSING_SALE: "Venda depois do fechamento",
  PRICE_DIVERGENCE: "Preço diferente do atual",
  DATE_ADJUSTED: "Data ajustada",
  DELETED_CUSTOMER: "Cliente excluído",
};

const money = (value: string | null | undefined) =>
  value === null || value === undefined ? "-" : formatCurrency(Number(value));
const dateTime = (value: string | null | undefined) => (value ? formatStoreDateTime(value) : "-");

/** O que a pendência significa, com os valores do caso. */
function issueDetails(issue: ReconciliationIssueItem): string {
  const d = issue.details;
  switch (issue.type) {
    case "NEGATIVE_STOCK":
      return `${issue.productName ?? "Produto"}: a venda baixou ${formatNumber(Number(d.quantity), 3)} e o saldo ficou em ${formatNumber(Number(d.stockAfter), 3)}. Confira a contagem e ajuste o estoque.`;
    case "POST_CLOSING_SALE":
      return `O caixa foi fechado em ${dateTime(d.closedAt)}; a venda (${money(d.total)}, ${money(d.cashAmount)} em dinheiro) entrou como ajuste pós-fechamento.`;
    case "PRICE_DIVERGENCE":
      return `${issue.productName ?? "Produto"}: vendido a ${money(d.practicedPrice)} (preço válido no período da autorização); o preço atual é ${money(d.currentPrice)}.`;
    case "DATE_ADJUSTED":
      return `O aparelho informou ${dateTime(d.reportedAt)}, fora do período permitido; a venda ficou em ${dateTime(d.adjustedAt)}.`;
    case "DELETED_CUSTOMER":
      return `O cliente foi excluído em ${dateTime(d.deletedAt)}, depois da venda. A venda foi mantida.`;
    default:
      return "";
  }
}

type Tab = "conflicts" | "issues" | "devices";

type Resolve =
  | { kind: "approve" | "discard"; conflict: OfflineConflictItem }
  | { kind: "acknowledge"; issue: ReconciliationIssueItem };

interface OfflineReconciliationManagerProps {
  conflicts: OfflineConflictItem[];
  conflictsHasMore: boolean;
  issues: ReconciliationIssueItem[];
  issuesHasMore: boolean;
  devices: OfflineDeviceItem[];
}

export function OfflineReconciliationManager({
  conflicts,
  conflictsHasMore,
  issues,
  issuesHasMore,
  devices,
}: OfflineReconciliationManagerProps) {
  const router = useRouter();
  const [askConfirm, confirmDialog] = useConfirm();
  const [tab, setTab] = useState<Tab>(
    conflicts.length > 0 ? "conflicts" : issues.length > 0 ? "issues" : "conflicts",
  );
  const [resolve, setResolve] = useState<Resolve | null>(null);
  const [resolvedConflicts, setResolvedConflicts] = useState<OfflineConflictItem[] | null>(null);
  const [acknowledgedIssues, setAcknowledgedIssues] = useState<ReconciliationIssueItem[] | null>(
    null,
  );
  const [loadingHistory, setLoadingHistory] = useState(false);

  const activeDevices = devices.filter((d) => !d.revokedAt).length;

  const loadHistory = async () => {
    setLoadingHistory(true);
    if (tab === "conflicts") {
      const result = await listOfflineConflicts({ resolved: true });
      if (result.success) setResolvedConflicts(result.data);
      else toast.error(result.error);
    } else {
      const result = await listReconciliationIssues({ acknowledged: true });
      if (result.success) setAcknowledgedIssues(result.data);
      else toast.error(result.error);
    }
    setLoadingHistory(false);
  };

  const afterChange = () => {
    // O histórico carregado fica desatualizado: some até ser pedido de novo
    setResolvedConflicts(null);
    setAcknowledgedIssues(null);
    router.refresh();
  };

  const revoke = async (device: OfflineDeviceItem) => {
    const ok = await askConfirm({
      title: `Revogar "${device.name}"?`,
      description:
        "O aparelho deixa de ser preparado para o PDV sem internet, e as vendas dele que chegarem depois viram conflito para um gerente decidir. Não dá para desfazer pela tela.",
      confirmLabel: "Revogar",
      destructive: true,
    });
    if (!ok) return;
    const result = await revokeOfflineDevice(device.id);
    if (result.success) {
      toast.success("Aparelho revogado.");
      router.refresh();
    } else {
      toast.error(result.error);
    }
  };

  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: "conflicts", label: "Conflitos", count: conflicts.length },
    { key: "issues", label: "Pendências", count: issues.length },
    { key: "devices", label: "Aparelhos", count: activeDevices },
  ];

  return (
    <div className="space-y-6">
      {confirmDialog}
      <PageHeader
        title="Sincronização offline"
        icon={RefreshCw}
        description="Vendas feitas sem internet que pedem decisão ou conferência, e os aparelhos preparados para o PDV."
      />

      <div className="flex flex-wrap items-center gap-2">
        <div className="bg-muted/40 inline-flex gap-1 rounded-lg border p-1">
          {tabs.map((t) => (
            <Button
              key={t.key}
              size="sm"
              variant={tab === t.key ? "default" : "ghost"}
              onClick={() => setTab(t.key)}
            >
              {t.label} ({t.count}
              {t.key === "conflicts" && conflictsHasMore ? "+" : ""}
              {t.key === "issues" && issuesHasMore ? "+" : ""})
            </Button>
          ))}
        </div>
        {tab !== "devices" && (
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={loadHistory}
            disabled={loadingHistory}
          >
            {loadingHistory ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <History className="h-4 w-4" />
            )}
            {tab === "conflicts" ? "Ver resolvidos" : "Ver conferidas"}
          </Button>
        )}
      </div>

      {tab === "conflicts" && (
        <div className="space-y-4">
          {conflicts.length === 0 ? (
            <EmptyState
              icon={Check}
              title="Nenhum conflito em aberto"
              description="Todas as vendas feitas sem internet que chegaram foram aplicadas ou já têm decisão."
            />
          ) : (
            conflicts.map((c) => (
              <ConflictCard
                key={c.operationId}
                conflict={c}
                onApprove={() => setResolve({ kind: "approve", conflict: c })}
                onDiscard={() => setResolve({ kind: "discard", conflict: c })}
              />
            ))
          )}
          {resolvedConflicts && (
            <HistorySection title="Conflitos resolvidos" empty={resolvedConflicts.length === 0}>
              {resolvedConflicts.map((c) => (
                <ConflictCard key={c.operationId} conflict={c} />
              ))}
            </HistorySection>
          )}
        </div>
      )}

      {tab === "issues" && (
        <div className="space-y-4">
          {issues.length === 0 ? (
            <EmptyState
              icon={Check}
              title="Nenhuma pendência a conferir"
              description="As vendas aplicadas pela sincronização não deixaram nada para acompanhar."
            />
          ) : (
            issues.map((i) => (
              <IssueCard
                key={i.id}
                issue={i}
                onAcknowledge={() => setResolve({ kind: "acknowledge", issue: i })}
              />
            ))
          )}
          {acknowledgedIssues && (
            <HistorySection title="Pendências conferidas" empty={acknowledgedIssues.length === 0}>
              {acknowledgedIssues.map((i) => (
                <IssueCard key={i.id} issue={i} />
              ))}
            </HistorySection>
          )}
        </div>
      )}

      {tab === "devices" &&
        (devices.length === 0 ? (
          <EmptyState
            icon={Smartphone}
            title="Nenhum aparelho preparado"
            description="Os aparelhos aparecem aqui depois da primeira preparação do PDV sem internet."
          />
        ) : (
          <div className="space-y-3">
            {devices.map((d) => (
              <DeviceCard key={d.id} device={d} onRevoke={() => revoke(d)} />
            ))}
          </div>
        ))}

      <ResolveDialog
        key={
          resolve
            ? `${resolve.kind}-${resolve.kind === "acknowledge" ? resolve.issue.id : resolve.conflict.operationId}`
            : "none"
        }
        resolve={resolve}
        onClose={() => setResolve(null)}
        onDone={() => {
          setResolve(null);
          afterChange();
        }}
      />
    </div>
  );
}

function HistorySection({
  title,
  empty,
  children,
}: {
  title: string;
  empty: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3 pt-2">
      <h2 className="text-muted-foreground text-sm font-semibold">{title}</h2>
      {empty ? <p className="text-muted-foreground text-sm">Nada por aqui ainda.</p> : children}
    </section>
  );
}

function ConflictCard({
  conflict: c,
  onApprove,
  onDiscard,
}: {
  conflict: OfflineConflictItem;
  onApprove?: () => void;
  onDiscard?: () => void;
}) {
  const open = c.status === "CONFLICT";
  const discardOnly = c.reason !== null && DISCARD_ONLY.has(c.reason);
  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              {c.reason && (
                <Badge variant={open ? "destructive" : "secondary"}>
                  {CONFLICT_REASONS[c.reason] ?? c.reason}
                </Badge>
              )}
              {c.status === "APPROVED" && (
                <Badge variant="success">Aprovada · Venda #{c.saleCode}</Badge>
              )}
              {c.status === "DISCARDED" && <Badge variant="secondary">Descartada</Badge>}
              <span className="text-sm font-semibold">
                {c.total === null ? "-" : formatCurrency(c.total)}
              </span>
              {c.paymentMethod && (
                <span className="text-muted-foreground text-sm">
                  · {PAYMENT_METHOD_LABELS[c.paymentMethod]}
                </span>
              )}
            </div>
            <p className="text-muted-foreground text-xs">
              Operador {c.userName}
              {c.deviceName && ` · ${c.deviceName}`} · venda em {dateTime(c.occurredAt)} · recebida
              em {dateTime(c.receivedAt)}
              {c.submittedByName && ` · enviada por ${c.submittedByName}`}
            </p>
          </div>
          {open && onApprove && onDiscard && (
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                onClick={onApprove}
                disabled={discardOnly}
                title={discardOnly ? "Esta venda não tem como ser gravada: descarte." : undefined}
              >
                <Check className="h-4 w-4" />
                Aprovar
              </Button>
              <Button size="sm" variant="destructive" className="gap-1.5" onClick={onDiscard}>
                <X className="h-4 w-4" />
                Descartar
              </Button>
            </div>
          )}
        </div>

        {c.message && <p className="text-sm">{c.message}</p>}

        <ul className="divide-y rounded-lg border text-sm">
          {c.items.map((item, index) => (
            <li
              key={`${item.productId}-${index}`}
              className="flex justify-between gap-3 px-3 py-1.5"
            >
              <span>{item.productName}</span>
              <span className="text-muted-foreground font-mono text-xs">
                {formatNumber(item.quantity, 3)} x {formatCurrency(item.unitPrice)}
              </span>
            </li>
          ))}
        </ul>

        {!open && (
          <p className="text-muted-foreground text-xs">
            {c.status === "APPROVED" ? "Aprovada" : "Descartada"} por {c.resolvedByName ?? "-"} em{" "}
            {dateTime(c.resolvedAt)}
            {c.resolutionNote && ` · Motivo: ${c.resolutionNote}`}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function IssueCard({
  issue: i,
  onAcknowledge,
}: {
  issue: ReconciliationIssueItem;
  onAcknowledge?: () => void;
}) {
  return (
    <Card>
      <CardContent className="flex flex-wrap items-start justify-between gap-3 p-4">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={i.acknowledgedAt ? "secondary" : "warning"}>
              {ISSUE_TYPES[i.type] ?? i.type}
            </Badge>
            <span className="text-sm font-semibold">Venda #{i.saleCode}</span>
            <span className="text-muted-foreground text-xs">
              {i.userName} · {dateTime(i.saleOccurredAt)}
            </span>
          </div>
          <p className="text-sm">{issueDetails(i)}</p>
          {i.acknowledgedAt && (
            <p className="text-muted-foreground text-xs">
              Conferida por {i.acknowledgedByName ?? "-"} em {dateTime(i.acknowledgedAt)}
              {i.note && ` · ${i.note}`}
            </p>
          )}
        </div>
        {!i.acknowledgedAt && onAcknowledge && (
          <div className="flex gap-2">
            {i.type === "NEGATIVE_STOCK" && (
              <Link
                href="/admin/estoque"
                className={buttonVariants({ size: "sm", variant: "ghost" })}
              >
                Ir ao estoque
              </Link>
            )}
            <Button size="sm" variant="outline" className="gap-1.5" onClick={onAcknowledge}>
              <ClipboardCheck className="h-4 w-4" />
              Dar ciência
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function DeviceCard({ device: d, onRevoke }: { device: OfflineDeviceItem; onRevoke: () => void }) {
  const revoked = d.revokedAt !== null;
  return (
    <Card className={cn(revoked && "opacity-70")}>
      <CardContent className="flex flex-wrap items-start justify-between gap-3 p-4">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Smartphone className="text-muted-foreground h-4 w-4" aria-hidden />
            <span className="font-semibold">{d.name}</span>
            {revoked ? (
              <Badge variant="destructive">Revogado</Badge>
            ) : (
              <Badge variant="success">Ativo</Badge>
            )}
            {d.pending !== null && d.pending > 0 && (
              <Badge variant="warning" className="gap-1">
                <TriangleAlert />
                {d.pending} {d.pending === 1 ? "venda a enviar" : "vendas a enviar"}
              </Badge>
            )}
          </div>
          <p className="text-muted-foreground text-xs">
            Operadores: {d.operators.join(", ") || "-"} · registrado por {d.registeredByName} em{" "}
            {dateTime(d.createdAt)}
          </p>
          <p className="text-muted-foreground text-xs">
            Última preparação: {dateTime(d.lastSyncAt)}
            {d.grantExpiresAt && ` · uso sem internet até ${dateTime(d.grantExpiresAt)}`}
            {d.pending === null && " · ainda não informou as vendas guardadas"}
          </p>
          {revoked && (
            <p className="text-destructive text-xs">
              Revogado por {d.revokedByName ?? "-"} em {dateTime(d.revokedAt)}
            </p>
          )}
        </div>
        {!revoked && (
          <Button
            size="sm"
            variant="outline"
            className="hover:text-destructive gap-1.5"
            onClick={onRevoke}
          >
            <Ban className="h-4 w-4" />
            Revogar
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

const RESOLVE_TEXT = {
  approve: {
    title: "Aprovar a venda",
    description:
      "A venda é gravada com o operador, o caixa e os preços originais, com a baixa de estoque. Se o caixa já foi fechado, ela entra como ajuste pós-fechamento.",
    noteLabel: "Observação (opcional)",
    confirm: "Aprovar venda",
  },
  discard: {
    title: "Descartar a venda",
    description:
      "Nenhuma venda é gravada e o estoque não muda. A decisão fica registrada com o motivo, e o aparelho mostra a venda como descartada.",
    noteLabel: "Motivo (obrigatório)",
    confirm: "Descartar venda",
  },
  acknowledge: {
    title: "Dar ciência da pendência",
    description: "A pendência sai da lista de conferência, com o seu nome e a observação.",
    noteLabel: "Observação (opcional)",
    confirm: "Dar ciência",
  },
} as const;

function ResolveDialog({
  resolve,
  onClose,
  onDone,
}: {
  resolve: Resolve | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!resolve) return null;

  const text = RESOLVE_TEXT[resolve.kind];
  const required = resolve.kind === "discard";

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = note.trim();
    if ((required || trimmed) && trimmed.length < NOTE_MIN) {
      setError(`O motivo precisa ter pelo menos ${NOTE_MIN} caracteres.`);
      return;
    }
    setSaving(true);
    setError(null);
    const result =
      resolve.kind === "acknowledge"
        ? await acknowledgeReconciliationIssue(resolve.issue.id, trimmed || undefined)
        : resolve.kind === "approve"
          ? await approveOfflineConflict(resolve.conflict.operationId, trimmed || undefined)
          : await discardOfflineConflict(resolve.conflict.operationId, trimmed);
    setSaving(false);
    if (!result.success) {
      setError(result.error ?? "Não foi possível concluir agora.");
      return;
    }
    if (resolve.kind === "approve" && "saleCode" in result && result.saleCode) {
      toast.success(`Venda #${result.saleCode} gravada.`);
    } else {
      toast.success(resolve.kind === "discard" ? "Venda descartada." : "Ciência registrada.");
    }
    onDone();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2">
            {resolve.kind === "discard" ? (
              <ShieldX className="text-destructive h-5 w-5" />
            ) : (
              <ClipboardCheck className="text-primary h-5 w-5" />
            )}
            <DialogTitle>{text.title}</DialogTitle>
          </div>
          <DialogDescription>{text.description}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          {error && (
            <div
              role="alert"
              className="text-destructive bg-destructive/10 border-destructive/20 rounded-md border p-2.5 text-xs"
            >
              {error}
            </div>
          )}
          <div className="space-y-1">
            <Label htmlFor="conciliacao-nota" className="text-xs">
              {text.noteLabel}
            </Label>
            <Textarea
              id="conciliacao-nota"
              value={note}
              maxLength={NOTE_MAX}
              required={required}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button
              type="submit"
              variant={resolve.kind === "discard" ? "destructive" : "default"}
              disabled={saving}
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {text.confirm}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
