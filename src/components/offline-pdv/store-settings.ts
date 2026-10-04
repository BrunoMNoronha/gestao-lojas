import type { StoreSettingsData } from "@/actions/settings";
import type { OfflineStore } from "@/lib/offline-snapshot";

// Dados da loja para o recibo do /pdv, a partir da cópia local; o Fiado não é oferecido no /pdv
// (docs/OFFLINE.md seção 3.4)
export function toStoreSettings(store: OfflineStore | null | undefined): StoreSettingsData {
  const value = (v: string | null | undefined) => v ?? undefined;
  return {
    personType: store?.personType === "INDIVIDUAL" ? "INDIVIDUAL" : "COMPANY",
    companyName: store?.companyName ?? "",
    tradeName: store?.tradeName ?? "",
    document: value(store?.document),
    phone: value(store?.phone),
    zipCode: value(store?.zipCode),
    address: value(store?.address),
    number: value(store?.number),
    neighborhood: value(store?.neighborhood),
    city: value(store?.city),
    state: value(store?.state),
    receiptFooterNote: value(store?.receiptFooterNote),
    onAccountEnabled: false,
  };
}
