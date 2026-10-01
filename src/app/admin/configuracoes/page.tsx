import { getStoreSettings } from "@/actions/settings";
import { StoreSettingsForm } from "@/components/store-settings-form";

export const metadata = {
  title: "Configurações da Loja | Gestão de Lojas",
  description: "Parametrização do sistema e dados cadastrais da loja",
};

export default async function SettingsPage() {
  const settings = await getStoreSettings();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Parametrização & Configurações da Loja</h1>
        <p className="text-sm text-muted-foreground">
          Gerencie os dados institucionais, endereço, redes sociais e parâmetros de exibição da empresa.
        </p>
      </div>

      <StoreSettingsForm initialSettings={settings} />
    </div>
  );
}
