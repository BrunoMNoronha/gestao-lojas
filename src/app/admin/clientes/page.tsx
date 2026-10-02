import { getCustomers } from "@/actions/customers";
import { CustomersManager } from "@/components/customers-manager";
import { connection } from "next/server";

export const metadata = {
  title: "Clientes | Gestão de Lojas",
};

export default async function ClientesPage() {
  // Clientes vêm do banco: renderiza a cada requisição em vez de prerenderizar no build
  await connection();

  const customers = await getCustomers();

  return <CustomersManager initialCustomers={customers} />;
}
