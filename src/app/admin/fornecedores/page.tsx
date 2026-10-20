import { getSuppliers } from "@/actions/suppliers";
import { SuppliersManager } from "@/components/suppliers-manager";
import { connection } from "next/server";
import { requirePageAccess } from "@/lib/authz";

export const metadata = {
  title: "Fornecedores",
};

export default async function FornecedoresPage() {
  // Fornecedores vêm do banco: renderiza a cada requisição em vez de prerenderizar no build
  await connection();
  await requirePageAccess("suppliers.manage");

  const suppliers = await getSuppliers();

  return <SuppliersManager initialSuppliers={suppliers} />;
}
