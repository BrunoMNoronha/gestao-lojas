import { getProducts } from "@/actions/products";
import { getCustomers } from "@/actions/customers";
import { getStoreSettings } from "@/actions/settings";
import { getCurrentCashRegister } from "@/actions/cash-register";
import { connection } from "next/server";
import Link from "next/link";
import { Wallet } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { PdvTerminal } from "@/components/pdv-terminal";
import { requirePageAccess } from "@/lib/authz";
import { EmptyState, UnavailableState } from "@/components/empty-state";

export const metadata = {
  title: "Frente de Caixa (PDV)",
};

export default async function PdvPage() {
  // O caixa precisa de produtos, preços e estoque atuais: renderiza a cada requisição
  await connection();
  await requirePageAccess("pdv.use");

  let data: Awaited<ReturnType<typeof loadPdvData>> | null = null;
  try {
    data = await loadPdvData();
  } catch (error) {
    console.error("Erro ao carregar o PDV:", error);
  }

  if (!data) {
    return (
      <UnavailableState
        title="Frente de Caixa indisponível"
        description="Não foi possível carregar os dados do PDV. Verifique a conexão com o banco de dados e recarregue a página."
      />
    );
  }

  // Vendas exigem caixa aberto do operador (o servidor também bloqueia em createSale)
  if (!data.hasOpenCashRegister) {
    return (
      <EmptyState
        fullPage
        headingLevel="h1"
        icon={Wallet}
        tone="primary"
        title="Caixa fechado"
        description="Abra o seu caixa com o suprimento inicial para começar a registrar vendas."
        action={
          <Link href="/admin/caixa" className={buttonVariants()}>
            Abrir caixa
          </Link>
        }
      />
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
