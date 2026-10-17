import { PdvOfflineLoader } from "@/components/offline-pdv/pdv-offline-loader";
import { NO_INDEX } from "@/lib/site-url";

export const metadata = {
  title: "Frente de Caixa (PDV)",
  robots: NO_INDEX,
};

// PDV que abre sem internet (issue #37, docs/OFFLINE.md seção 6.2). Página estática, fora do
// /admin e sem dados do usuário no HTML: o Service Worker a guarda para abrir sem rede. Por isso
// não usa requirePageAccess; a sessão e a permissão "pdv.use" são conferidas nos Route Handlers
// de /api/offline, que entregam os dados. O /admin/pdv continua sendo o PDV online.
export default function OfflinePdvPage() {
  return <PdvOfflineLoader />;
}
