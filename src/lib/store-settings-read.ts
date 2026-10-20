import { cache } from "react";
import { prisma } from "@/lib/prisma";

// Compartilhado somente durante a renderização. Transações de venda leem seu próprio snapshot.
export const readStoreSettings = cache(() =>
  prisma.storeSettings.findUnique({ where: { id: "default" } }),
);
