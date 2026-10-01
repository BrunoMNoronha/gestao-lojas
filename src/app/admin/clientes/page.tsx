import { getCustomers } from "@/actions/customers";
import { CustomersManager } from "@/components/customers-manager";

export const metadata = {
  title: "Clientes | Gestão de Lojas",
};

export default async function ClientesPage() {
  const customers = await getCustomers();

  return <CustomersManager initialCustomers={customers} />;
}
