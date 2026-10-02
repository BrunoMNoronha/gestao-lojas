"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { StoreSettingsData, updateStoreSettings } from "@/actions/settings";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Building2, ExternalLink, MapPin, Share2, Receipt, Save, Store } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { formatWhatsappNumber, normalizeWhatsappNumber } from "@/lib/catalog-shared";

interface Props {
  initialSettings: StoreSettingsData;
}

export function StoreSettingsForm({ initialSettings }: Props) {
  const [formData, setFormData] = useState<StoreSettingsData>(initialSettings);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (normalizeWhatsappNumber(formData.whatsappNumber) === null) {
      toast.error("Número do WhatsApp inválido. Informe DDD e número, ex.: (11) 99999-8888.");
      return;
    }
    setLoading(true);

    const res = await updateStoreSettings(formData);
    setLoading(false);

    if (res.success) {
      // O servidor guarda o número normalizado (só dígitos, com DDI)
      setFormData((prev) => ({ ...prev, whatsappNumber: res.data?.whatsappNumber ?? "" }));
      toast.success("Configurações da loja salvas com sucesso!");
      // Atualiza o nome da loja exibido na sidebar
      router.refresh();
    } else {
      toast.error(res.error || "Erro ao salvar configurações.");
    }
  };

  return (
    <form onSubmit={handleSubmit} className="max-w-4xl space-y-6">
      {/* Dados Principais */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Building2 className="text-primary h-5 w-5" />
            Dados Básicos da Loja
          </CardTitle>
          <CardDescription>
            Identificação jurídica e comercial da empresa exibida nos comprovantes e cabeçalhos.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="store-settings-razao-social" className="text-sm font-medium">
              Razão Social *
            </Label>
            <Input
              id="store-settings-razao-social"
              name="companyName"
              value={formData.companyName}
              onChange={handleChange}
              placeholder="Ex: Comercial Silva Ltda"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="store-settings-nome-fantasia" className="text-sm font-medium">
              Nome Fantasia *
            </Label>
            <Input
              id="store-settings-nome-fantasia"
              name="tradeName"
              value={formData.tradeName}
              onChange={handleChange}
              placeholder="Ex: Agropecuária & Distribuidora Silva"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="store-settings-cnpj-opcional" className="text-sm font-medium">
              CNPJ (Opcional)
            </Label>
            <Input
              id="store-settings-cnpj-opcional"
              name="document"
              value={formData.document || ""}
              onChange={handleChange}
              placeholder="00.000.000/0001-00"
            />
          </div>

          <div className="space-y-2">
            <Label
              htmlFor="store-settings-inscricao-estadual-opcional"
              className="text-sm font-medium"
            >
              Inscrição Estadual (Opcional)
            </Label>
            <Input
              id="store-settings-inscricao-estadual-opcional"
              name="stateRegistration"
              value={formData.stateRegistration || ""}
              onChange={handleChange}
              placeholder="Isento ou Nº I.E."
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="store-settings-telefone-whatsapp" className="text-sm font-medium">
              Telefone / WhatsApp
            </Label>
            <Input
              id="store-settings-telefone-whatsapp"
              name="phone"
              value={formData.phone || ""}
              onChange={handleChange}
              placeholder="(00) 90000-0000"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="store-settings-e-mail-de-contato" className="text-sm font-medium">
              E-mail de Contato
            </Label>
            <Input
              id="store-settings-e-mail-de-contato"
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
            <MapPin className="text-primary h-5 w-5" />
            Endereço Comercial
          </CardTitle>
          <CardDescription>Localização física para emissão de documentos e notas.</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="store-settings-cep" className="text-sm font-medium">
              CEP
            </Label>
            <Input
              id="store-settings-cep"
              name="zipCode"
              value={formData.zipCode || ""}
              onChange={handleChange}
              placeholder="00000-000"
            />
          </div>

          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="store-settings-logradouro-rua-av" className="text-sm font-medium">
              Logradouro (Rua, Av.)
            </Label>
            <Input
              id="store-settings-logradouro-rua-av"
              name="address"
              value={formData.address || ""}
              onChange={handleChange}
              placeholder="Av. Principal"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="store-settings-numero" className="text-sm font-medium">
              Número
            </Label>
            <Input
              id="store-settings-numero"
              name="number"
              value={formData.number || ""}
              onChange={handleChange}
              placeholder="100"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="store-settings-bairro" className="text-sm font-medium">
              Bairro
            </Label>
            <Input
              id="store-settings-bairro"
              name="neighborhood"
              value={formData.neighborhood || ""}
              onChange={handleChange}
              placeholder="Centro"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-2">
              <Label htmlFor="store-settings-cidade" className="text-sm font-medium">
                Cidade
              </Label>
              <Input
                id="store-settings-cidade"
                name="city"
                value={formData.city || ""}
                onChange={handleChange}
                placeholder="São Paulo"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="store-settings-uf" className="text-sm font-medium">
                UF
              </Label>
              <Input
                id="store-settings-uf"
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
            <Share2 className="text-primary h-5 w-5" />
            Redes Sociais & Links
          </CardTitle>
          <CardDescription>
            Links e arrobas exibidos no rodapé do recibo do cliente.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="store-settings-instagram" className="text-sm font-medium">
              Instagram
            </Label>
            <Input
              id="store-settings-instagram"
              name="instagram"
              value={formData.instagram || ""}
              onChange={handleChange}
              placeholder="@minhaloja"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="store-settings-facebook" className="text-sm font-medium">
              Facebook
            </Label>
            <Input
              id="store-settings-facebook"
              name="facebook"
              value={formData.facebook || ""}
              onChange={handleChange}
              placeholder="facebook.com/minhaloja"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="store-settings-website" className="text-sm font-medium">
              Website
            </Label>
            <Input
              id="store-settings-website"
              name="website"
              value={formData.website || ""}
              onChange={handleChange}
              placeholder="www.minhaloja.com.br"
            />
          </div>
        </CardContent>
      </Card>

      {/* Catálogo público */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Store className="text-primary h-5 w-5" />
            Catálogo Público
          </CardTitle>
          <CardDescription>
            Vitrine sem login em que o cliente monta o carrinho e envia o pedido pelo WhatsApp. Os
            produtos exibidos são escolhidos no cadastro de cada produto.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="flex items-start justify-between gap-3 rounded-lg border p-3">
            <div className="space-y-1">
              <Label htmlFor="store-settings-catalogo-ativo" className="text-sm font-medium">
                Catálogo público ativo
              </Label>
              <p className="text-muted-foreground text-xs">
                Desligado, o endereço mostra &quot;catálogo indisponível&quot;.
              </p>
              <Link
                href="/catalogo"
                target="_blank"
                className="text-primary inline-flex items-center gap-1 text-xs font-medium hover:underline"
              >
                Abrir /catalogo <ExternalLink className="size-3" aria-hidden />
              </Link>
            </div>
            <Switch
              id="store-settings-catalogo-ativo"
              checked={!!formData.catalogEnabled}
              onCheckedChange={(checked) =>
                setFormData((prev) => ({ ...prev, catalogEnabled: checked }))
              }
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="store-settings-whatsapp-do-catalogo" className="text-sm font-medium">
              WhatsApp para pedidos
            </Label>
            <Input
              id="store-settings-whatsapp-do-catalogo"
              type="tel"
              inputMode="tel"
              autoComplete="off"
              value={formatWhatsappNumber(formData.whatsappNumber || "")}
              onChange={(e) =>
                setFormData((prev) => ({
                  ...prev,
                  whatsappNumber: e.target.value.replace(/\D/g, "").slice(0, 15),
                }))
              }
              placeholder="+55 (11) 99999-8888"
              aria-describedby="store-settings-whatsapp-ajuda"
            />
            <p id="store-settings-whatsapp-ajuda" className="text-muted-foreground text-xs">
              Com DDD; sem o código do país, assume +55. Sem número, o catálogo funciona, mas o
              envio do pedido fica desabilitado.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Recibo / PDV */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Receipt className="text-primary h-5 w-5" />
            Parametrização de Comprovantes (PDV)
          </CardTitle>
          <CardDescription>
            Mensagens personalizadas exibidas aos clientes na venda.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="store-settings-mensagem-do-rodape-do" className="text-sm font-medium">
              Mensagem do Rodapé do Recibo
            </Label>
            <Input
              id="store-settings-mensagem-do-rodape-do"
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
        <Button type="submit" disabled={loading} className="min-w-[160px] gap-2">
          <Save className="h-4 w-4" />
          {loading ? "Salvando..." : "Salvar Configurações"}
        </Button>
      </div>
    </form>
  );
}
