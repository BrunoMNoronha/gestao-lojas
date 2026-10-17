import { getPdvProducts } from "@/actions/browse";
import { getCustomerOptions } from "@/actions/browse";
import { getStoreSettings } from "@/actions/settings";
import { getOpenCashRegister } from "@/actions/cash-register";
import { getCatalogOrderForPdv } from "@/actions/catalog-orders";
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

export default async function PdvPage({
  searchParams,
}: {
  searchParams: Promise<{ pedido?: string }>;
}) {
  const { pedido } = await searchParams;
  // O caixa precisa de produtos, preços e estoque atuais: renderiza a cada requisição
  await connection();
  const user = await requirePageAccess("pdv.use");

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
  if (!data.cashRegisterId) {
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

  // Pedido do catálogo carregado pelo painel (issue #81): itens com preço e estoque de agora. Os
  // produtos do pedido entram na lista do terminal, que confere o estoque por ela ao finalizar.
  const catalogOrder =
    typeof pedido === "string" && pedido ? await getCatalogOrderForPdv(pedido) : null;
  const products = catalogOrder?.ok
    ? [
        ...data.products,
        ...catalogOrder.order.lines
          .map((line) => line.product)
          .filter((product) => !data.products.some((p) => p.id === product.id)),
      ]
    : data.products;
  // O cliente vinculado ao pedido entra na lista para já vir selecionado
  const orderCustomer = catalogOrder?.ok ? catalogOrder.order.customer : null;
  const customers =
    orderCustomer && !data.customers.some((c) => c.id === orderCustomer.id)
      ? [orderCustomer, ...data.customers]
      : data.customers;

  return (
    <PdvTerminal
      // Um pedido novo remonta o terminal com o carrinho do pedido
      key={catalogOrder?.ok ? catalogOrder.order.id : "pdv"}
      remoteSearch
      products={products}
      customers={customers}
      storeSettings={data.storeSettings}
      cashRegisterId={data.cashRegisterId}
      unpackScope={`pdv:${user.id}`}
      catalogOrder={catalogOrder}
    />
  );
}

// As listas têm fallback próprio; getOpenCashRegister propaga falhas do banco
async function loadPdvData() {
  const [products, customers, storeSettings, cashRegister] = await Promise.all([
    getPdvProducts(),
    getCustomerOptions(),
    getStoreSettings(),
    getOpenCashRegister(),
  ]);
  // A venda leva o id do caixa em que começou: se ele for fechado antes do envio, o servidor recusa
  return { products, customers, storeSettings, cashRegisterId: cashRegister?.id ?? null };
}
