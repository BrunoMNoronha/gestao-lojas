import { connection } from "next/server";
import {
  listOfflineConflicts,
  listOfflineDevices,
  listReconciliationIssues,
} from "@/actions/offline-reconciliation";
import { OfflineReconciliationManager } from "@/components/offline-reconciliation-manager";
import { UnavailableState } from "@/components/empty-state";
import { requirePageAccess } from "@/lib/authz";

export const metadata = {
  title: "Sincronização offline",
};

// Conciliação das vendas feitas sem internet (issue #38, docs/OFFLINE.md seção 4): conflitos a
// aprovar ou descartar, pendências a conferir e aparelhos preparados, com revogação.
export default async function SincronizacaoPage() {
  // Conflitos e pendências chegam a cada sincronização: renderiza a cada requisição
  await connection();
  await requirePageAccess("offline.reconcile");

  const [conflicts, issues, devices] = await Promise.all([
    listOfflineConflicts(),
    listReconciliationIssues(),
    listOfflineDevices(),
  ]);

  if (!conflicts.success || !issues.success || !devices.success) {
    return (
      <UnavailableState
        title="Sincronização offline indisponível"
        description="Não foi possível carregar os conflitos, as pendências e os aparelhos. Verifique a conexão com o banco de dados e recarregue a página."
      />
    );
  }

  return (
    <OfflineReconciliationManager
      conflicts={conflicts.data}
      conflictsHasMore={conflicts.hasMore}
      issues={issues.data}
      issuesHasMore={issues.hasMore}
      devices={devices.data}
    />
  );
}
