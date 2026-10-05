import { getStoreSettings } from "@/actions/settings";
import { getTestDataOverview } from "@/actions/test-data";
import { StoreSettingsForm } from "@/components/store-settings-form";
import { TestDataPanel } from "@/components/test-data-panel";
import { connection } from "next/server";
import { requirePageAccess } from "@/lib/authz";
import { PageHeader } from "@/components/page-header";
import { Settings } from "lucide-react";

export const metadata = {
  title: "Configurações da Loja",
  description: "Parametrização do sistema e dados cadastrais da loja",
};

export default async function SettingsPage() {
  // Configurações da loja vêm do banco: renderiza a cada requisição em vez de prerenderizar no build
  await connection();
  // settings.manage é só do ADMIN: a seção "Dados de teste" (issue #57) também fica restrita a ele
  await requirePageAccess("settings.manage");

  const [settings, testData] = await Promise.all([getStoreSettings(), getTestDataOverview()]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Configurações da Loja"
        icon={Settings}
        description="Gerencie os dados institucionais, endereço, redes sociais e parâmetros de exibição da empresa."
      />

      <StoreSettingsForm initialSettings={settings} />

      {/* Sem ENABLE_STORE_TEST_TOOLS=true (produção), a seção não aparece (issue #67) */}
      {testData !== "disabled" && <TestDataPanel overview={testData} />}
    </div>
  );
}
