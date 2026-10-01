import { getSuppliers } from "@/actions/suppliers";
import { SuppliersManager } from "@/components/suppliers-manager";

export const metadata = {
  title: "Fornecedores | Gestão de Lojas",
};

export default async function FornecedoresPage() {
  const suppliers = await getSuppliers();

  return <SuppliersManager initialSuppliers={suppliers} />;
}
