import { getCustomerPage } from "@/actions/browse";
import { pageNumber } from "@/lib/pagination";
import { CustomersManager } from "@/components/customers-manager";
import { connection } from "next/server";
import { requirePageAccess } from "@/lib/authz";
import { can } from "@/lib/permissions";

export const metadata = {
  title: "Clientes",
};

export default async function ClientesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string; category?: string; catalog?: string }>;
}) {
  const query = await searchParams;
  // Clientes vêm do banco: renderiza a cada requisição em vez de prerenderizar no build
  await connection();
  const user = await requirePageAccess("customers.view");

  const customers = await getCustomerPage({ ...query, page: pageNumber(query.page) });

  return (
    <CustomersManager
      initialCustomers={customers.items}
      pagination={{ page: customers.page, total: customers.total }}
      canDelete={can(user.role, "customers.delete")}
    />
  );
}
