import type { CatalogOrderStatus } from "@prisma/client";
import { Badge } from "@/components/ui/badge";

// Rótulos dos pedidos do catálogo (issue #81)
export const CATALOG_ORDER_STATUS_LABELS: Record<CatalogOrderStatus, string> = {
  OPEN: "Disponível",
  CANCELED: "Cancelado",
  CONVERTED: "Convertido em venda",
};

const STATUS_VARIANTS = {
  OPEN: "warning",
  CANCELED: "secondary",
  CONVERTED: "success",
} as const;

export function CatalogOrderStatusBadge({ status }: { status: CatalogOrderStatus }) {
  return (
    <Badge variant={STATUS_VARIANTS[status]} className="text-[11px]">
      {CATALOG_ORDER_STATUS_LABELS[status]}
    </Badge>
  );
}
