"use client";

import { useState } from "react";
import { StoreSettingsData, updateStoreSettings } from "@/actions/settings";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Building2, MapPin, Share2, Receipt, Save, CheckCircle2, AlertCircle } from "lucide-react";

interface Props {
  initialSettings: StoreSettingsData;
}

export function StoreSettingsForm({ initialSettings }: Props) {
  const [formData, setFormData] = useState<StoreSettingsData>(initialSettings);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage(null);

    const res = await updateStoreSettings(formData);
    setLoading(false);

    if (res.success) {
      setMessage({ type: "success", text: "Configurações da loja salvas com sucesso!" });
    } else {
      setMessage({ type: "error", text: res.error || "Erro ao salvar configurações." });
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6 max-w-4xl">
      {message && (
        <div
          className={`p-4 rounded-lg flex items-center gap-3 border ${
            message.type === "success"
              ? "bg-emerald-50 border-emerald-200 text-emerald-800 dark:bg-emerald-950/40 dark:border-emerald-800 dark:text-emerald-200"
              : "bg-red-50 border-red-200 text-red-800 dark:bg-red-950/40 dark:border-red-800 dark:text-red-200"
          }`}
        >
          {message.type === "success" ? (
            <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
          ) : (
            <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 shrink-0" />
          )}
          <span className="text-sm font-medium">{message.text}</span>
        </div>
      )}

      {/* Dados Principais */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Building2 className="w-5 h-5 text-primary" />
            Dados Básicos da Loja
          </CardTitle>
          <CardDescription>
            Identificação jurídica e comercial da empresa exibida nos comprovantes e cabeçalhos.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Razão Social *</label>
            <Input
              name="companyName"
              value={formData.companyName}
              onChange={handleChange}
              placeholder="Ex: Comercial Silva Ltda"
              required
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Nome Fantasia *</label>
            <Input
              name="tradeName"
              value={formData.tradeName}
              onChange={handleChange}
              placeholder="Ex: Agropecuária & Distribuidora Silva"
              required
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">CNPJ (Opcional)</label>
            <Input
              name="document"
              value={formData.document || ""}
              onChange={handleChange}
              placeholder="00.000.000/0001-00"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Inscrição Estadual (Opcional)</label>
            <Input
              name="stateRegistration"
              value={formData.stateRegistration || ""}
              onChange={handleChange}
              placeholder="Isento ou Nº I.E."
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Telefone / WhatsApp</label>
            <Input
              name="phone"
              value={formData.phone || ""}
              onChange={handleChange}
              placeholder="(00) 90000-0000"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">E-mail de Contato</label>
            <Input
              type="email"
              name="email"
              value={formData.email || ""}
              onChange={handleChange}
              placeholder="contato@loja.com.br"
            />
          </div>
        </CardContent>
      </Card>

      {/* Endereço */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <MapPin className="w-5 h-5 text-primary" />
            Endereço Comercial
          </CardTitle>
          <CardDescription>Localização física para emissão de documentos e notas.</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">CEP</label>
            <Input
              name="zipCode"
              value={formData.zipCode || ""}
              onChange={handleChange}
              placeholder="00000-000"
            />
          </div>

          <div className="space-y-2 md:col-span-2">
            <label className="text-sm font-medium">Logradouro (Rua, Av.)</label>
            <Input
              name="address"
              value={formData.address || ""}
              onChange={handleChange}
              placeholder="Av. Principal"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Número</label>
            <Input
              name="number"
              value={formData.number || ""}
              onChange={handleChange}
              placeholder="100"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Bairro</label>
            <Input
              name="neighborhood"
              value={formData.neighborhood || ""}
              onChange={handleChange}
              placeholder="Centro"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-2">
              <label className="text-sm font-medium">Cidade</label>
              <Input
                name="city"
                value={formData.city || ""}
                onChange={handleChange}
                placeholder="São Paulo"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">UF</label>
              <Input
                name="state"
                value={formData.state || ""}
                onChange={handleChange}
                placeholder="SP"
                maxLength={2}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Redes Sociais & Presença Digital */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Share2 className="w-5 h-5 text-primary" />
            Redes Sociais & Links
          </CardTitle>
          <CardDescription>Links e arrobas exibidos no rodapé do recibo do cliente.</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Instagram</label>
            <Input
              name="instagram"
              value={formData.instagram || ""}
              onChange={handleChange}
              placeholder="@minhaloja"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Facebook</label>
            <Input
              name="facebook"
              value={formData.facebook || ""}
              onChange={handleChange}
              placeholder="facebook.com/minhaloja"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Website</label>
            <Input
              name="website"
              value={formData.website || ""}
              onChange={handleChange}
              placeholder="www.minhaloja.com.br"
            />
          </div>
        </CardContent>
      </Card>

      {/* Recibo / PDV */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Receipt className="w-5 h-5 text-primary" />
            Parametrização de Comprovantes (PDV)
          </CardTitle>
          <CardDescription>Mensagens personalizadas exibidas aos clientes na venda.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Mensagem do Rodapé do Recibo</label>
            <Input
              name="receiptFooterNote"
              value={formData.receiptFooterNote || ""}
              onChange={handleChange}
              placeholder="Ex: Obrigado pela preferência! Volte sempre."
            />
          </div>
        </CardContent>
      </Card>

      {/* Botão de Salvar */}
      <div className="flex justify-end pt-2">
        <Button type="submit" disabled={loading} className="gap-2 min-w-[160px]">
          <Save className="w-4 h-4" />
          {loading ? "Salvando..." : "Salvar Configurações"}
        </Button>
      </div>
    </form>
  );
}
