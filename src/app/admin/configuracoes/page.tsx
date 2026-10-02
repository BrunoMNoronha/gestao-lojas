import { getStoreSettings } from "@/actions/settings";
import { StoreSettingsForm } from "@/components/store-settings-form";
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
  await requirePageAccess("settings.manage");

  const settings = await getStoreSettings();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Configurações da Loja"
        icon={Settings}
        description="Gerencie os dados institucionais, endereço, redes sociais e parâmetros de exibição da empresa."
      />

      <StoreSettingsForm initialSettings={settings} />
    </div>
  );
}
