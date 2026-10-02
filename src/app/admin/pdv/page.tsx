import { getProducts } from "@/actions/products";
import { getCustomers } from "@/actions/customers";
import { getStoreSettings } from "@/actions/settings";
import { getCurrentCashRegister } from "@/actions/cash-register";
import { connection } from "next/server";
import Link from "next/link";
import { Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PdvTerminal } from "@/components/pdv-terminal";

export const metadata = {
  title: "Frente de Caixa (PDV) | Gestão de Lojas",
};

export default async function PdvPage() {
  // O caixa precisa de produtos, preços e estoque atuais: renderiza a cada requisição
  await connection();

  let data: Awaited<ReturnType<typeof loadPdvData>> | null = null;
  try {
    data = await loadPdvData();
  } catch (error) {
    console.error("Erro ao carregar o PDV:", error);
  }

  if (!data) {
    return (
      <div className="flex h-[calc(100vh-4rem)] items-center justify-center">
        <div className="bg-card max-w-md rounded-lg border p-6 text-center">
          <h2 className="text-lg font-semibold">Frente de Caixa indisponível</h2>
          <p className="text-muted-foreground mt-2 text-sm">
            Não foi possível carregar os dados do PDV. Verifique a conexão com o banco de dados e
            recarregue a página.
          </p>
        </div>
      </div>
    );
  }

  // Vendas exigem caixa aberto do operador (o servidor também bloqueia em createSale)
  if (!data.hasOpenCashRegister) {
    return (
      <div className="flex h-[calc(100vh-4rem)] items-center justify-center">
        <div className="bg-card max-w-md rounded-lg border p-6 text-center">
          <Wallet className="text-primary mx-auto mb-3 h-10 w-10" />
          <h2 className="text-lg font-semibold">Caixa fechado</h2>
          <p className="text-muted-foreground mt-2 text-sm">
            Abra o seu caixa com o suprimento inicial para começar a registrar vendas.
          </p>
          <Link href="/admin/caixa">
            <Button className="mt-4">Abrir caixa</Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <PdvTerminal
      products={data.products}
      customers={data.customers}
      storeSettings={data.storeSettings}
    />
  );
}

// As listas têm fallback próprio; getCurrentCashRegister propaga falhas do banco
async function loadPdvData() {
  const [products, customers, storeSettings, cashRegister] = await Promise.all([
    getProducts(),
    getCustomers(),
    getStoreSettings(),
    getCurrentCashRegister(),
  ]);
  return { products, customers, storeSettings, hasOpenCashRegister: !!cashRegister };
}
