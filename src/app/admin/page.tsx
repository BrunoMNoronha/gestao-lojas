import Link from "next/link";
import { getStoreSettings } from "@/actions/settings";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Building2, Settings, ShoppingCart, Package, Boxes, Users } from "lucide-react";

export default async function AdminDashboardPage() {
  const settings = await getStoreSettings();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Painel de Controle</h1>
          <p className="text-sm text-muted-foreground">
            Bem-vindo ao sistema de gestão da <span className="font-semibold text-foreground">{settings.tradeName}</span>
          </p>
        </div>
        <Link href="/admin/configuracoes">
          <Button variant="outline" className="gap-2">
            <Settings className="w-4 h-4" />
            Configurar Loja
          </Button>
        </Link>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="hover:border-primary/50 transition-colors">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Frente de Caixa</CardTitle>
            <ShoppingCart className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">PDV Rápido</div>
            <CardDescription className="mt-1">Realizar vendas e emitir comprovantes.</CardDescription>
          </CardContent>
        </Card>

        <Card className="hover:border-primary/50 transition-colors">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Produtos</CardTitle>
            <Package className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">Catálogo</div>
            <CardDescription className="mt-1">Gerenciar itens, preços e categorias.</CardDescription>
          </CardContent>
        </Card>

        <Card className="hover:border-primary/50 transition-colors">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Empresa</CardTitle>
            <Building2 className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-ellipsis overflow-hidden whitespace-nowrap">
              {settings.tradeName}
            </div>
            <CardDescription className="mt-1">
              {settings.document ? `CNPJ: ${settings.document}` : "CNPJ não cadastrado"}
            </CardDescription>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
