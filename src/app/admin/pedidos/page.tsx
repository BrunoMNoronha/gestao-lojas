import { connection } from "next/server";
import { getCatalogOrderPage } from "@/actions/catalog-orders";
import { CatalogOrdersManager } from "@/components/catalog-orders-manager";
import { requirePageAccess } from "@/lib/authz";
import { pageNumber } from "@/lib/pagination";

export const metadata = {
  title: "Pedidos do catálogo",
};

const STATUS_FILTERS = ["OPEN", "CONVERTED", "CANCELED", "ALL"];

export default async function PedidosPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; page?: string; pedido?: string }>;
}) {
  const query = await searchParams;
  // Pedidos vêm do banco: renderiza a cada requisição em vez de prerenderizar no build
  await connection();
  await requirePageAccess("pdv.use");

  // Padrão: só os disponíveis, que são os que pedem ação do operador
  const status = STATUS_FILTERS.includes(query.status ?? "") ? query.status! : "OPEN";
  const orders = await getCatalogOrderPage({
    status: status === "ALL" ? undefined : status,
    page: pageNumber(query.page),
  });

  return (
    <CatalogOrdersManager
      orders={orders.items}
      status={status}
      pagination={{ page: orders.page, total: orders.total }}
      failed={orders.failed}
      initialOrderId={typeof query.pedido === "string" ? query.pedido : null}
    />
  );
}
