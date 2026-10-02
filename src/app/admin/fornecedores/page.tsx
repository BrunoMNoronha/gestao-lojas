import { getSuppliers } from "@/actions/suppliers";
import { SuppliersManager } from "@/components/suppliers-manager";
import { connection } from "next/server";

export const metadata = {
  title: "Fornecedores | Gestão de Lojas",
};

export default async function FornecedoresPage() {
  // Fornecedores vêm do banco: renderiza a cada requisição em vez de prerenderizar no build
  await connection();

  const suppliers = await getSuppliers();

  return <SuppliersManager initialSuppliers={suppliers} />;
}
