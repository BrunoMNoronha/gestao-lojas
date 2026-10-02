import { getCustomers } from "@/actions/customers";
import { CustomersManager } from "@/components/customers-manager";
import { connection } from "next/server";
import { requirePageAccess } from "@/lib/authz";
import { can } from "@/lib/permissions";

export const metadata = {
  title: "Clientes",
};

export default async function ClientesPage() {
  // Clientes vêm do banco: renderiza a cada requisição em vez de prerenderizar no build
  await connection();
  const user = await requirePageAccess("customers.view");

  const customers = await getCustomers();

  return <CustomersManager
      initialCustomers={customers}
      canDelete={can(user.role, "customers.delete")}
    />;
}
