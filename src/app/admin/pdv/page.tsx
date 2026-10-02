import { getProducts } from "@/actions/products";
import { getCustomers } from "@/actions/customers";
import { getStoreSettings } from "@/actions/settings";
import { connection } from "next/server";
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

  return (
    <PdvTerminal
      products={data.products}
      customers={data.customers}
      storeSettings={data.storeSettings}
    />
  );
}

// Cada consulta já possui fallback próprio (lista vazia / configurações padrão)
async function loadPdvData() {
  const [products, customers, storeSettings] = await Promise.all([
    getProducts(),
    getCustomers(),
    getStoreSettings(),
  ]);
  return { products, customers, storeSettings };
}
