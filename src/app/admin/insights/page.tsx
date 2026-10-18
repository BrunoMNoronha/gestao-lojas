import { connection } from "next/server";
import { getInsightsOverview } from "@/actions/insights";
import { InsightsView } from "@/components/insights-view";
import { UnavailableState } from "@/components/empty-state";
import { requirePageAccess } from "@/lib/authz";
import { can } from "@/lib/permissions";
import { currentMonthDayKeys } from "@/lib/store-time";

export const metadata = {
  title: "Insights",
  description: "Análises do negócio geradas pelo Claude a partir dos números da loja",
};

// Server Actions desta página chamam o Claude, que pode levar dezenas de segundos
export const maxDuration = 120;

export default async function InsightsPage() {
  // Histórico e período padrão mudam a cada análise e a cada dia
  await connection();
  const user = await requirePageAccess("insights.view");

  const overview = await getInsightsOverview();
  if (!overview) {
    return <UnavailableState title="Insights indisponíveis" />;
  }

  return (
    <InsightsView
      overview={overview}
      initialPeriod={currentMonthDayKeys()}
      canConfigure={can(user.role, "settings.manage")}
    />
  );
}
