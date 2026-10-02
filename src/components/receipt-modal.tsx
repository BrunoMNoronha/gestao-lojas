"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Printer, CheckCircle, ShoppingBag } from "lucide-react";
import { formatCurrency, formatNumber } from "@/lib/utils";
import { StoreSettingsData } from "@/actions/settings";
import { displayCep, displayDocument, displayPhone } from "@/lib/masks";

export interface CompletedSale {
  id: string;
  code: number;
  total: number;
  discount: number;
  paymentMethod: string;
  amountPaid: number;
  change: number;
  createdAt: string;
  userName: string;
  customerName: string;
  customerDocument?: string | null;
  items: {
    id: string;
    productId: string;
    productName: string;
    unit: string;
    quantity: number;
    unitPrice: number;
    subtotal: number;
  }[];
}

interface ReceiptModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sale: CompletedSale | null;
  storeSettings: StoreSettingsData;
}

const paymentMethodLabels: Record<string, string> = {
  MONEY: "Dinheiro",
  PIX: "PIX",
  CREDIT_CARD: "Cartão de Crédito",
  DEBIT_CARD: "Cartão de Débito",
  ON_ACCOUNT: "Fiado / Em Conta",
};

export function ReceiptModal({ open, onOpenChange, sale, storeSettings }: ReceiptModalProps) {
  if (!sale) return null;

  const handlePrint = () => {
    window.print();
  };

  const formattedDate = new Date(sale.createdAt).toLocaleString("pt-BR", {
    dateStyle: "short",
    timeStyle: "medium",
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader className="print:hidden">
          <div className="text-success flex items-center gap-2">
            <CheckCircle className="h-6 w-6" />
            <DialogTitle className="text-foreground text-lg font-bold">
              Venda Concluída com Sucesso!
            </DialogTitle>
          </div>
        </DialogHeader>

        {/* RECEIPT PRINT AREA */}
        <div
          id="receipt-print-area"
          className="space-y-3 rounded-lg border bg-white p-4 font-mono text-xs text-black shadow-inner print:w-full print:border-none print:p-0 print:shadow-none"
        >
          {/* Store Header */}
          <div className="space-y-1 border-b border-dashed border-gray-400 pb-2 text-center">
            <h2 className="text-sm font-bold tracking-wide uppercase">
              {storeSettings.tradeName || storeSettings.companyName || "MINHA LOJA"}
            </h2>
            {storeSettings.companyName && (
              <p className="text-[10px] text-gray-600">{storeSettings.companyName}</p>
            )}
            {storeSettings.document && (
              <p>
                {storeSettings.personType === "INDIVIDUAL" ? "CPF" : "CNPJ"}:{" "}
                {displayDocument(storeSettings.document)}
              </p>
            )}
            {storeSettings.address && (
              <p>
                {storeSettings.address}
                {storeSettings.number ? `, ${storeSettings.number}` : ""}
                {storeSettings.neighborhood ? ` - ${storeSettings.neighborhood}` : ""}
              </p>
            )}
            {storeSettings.city && (
              <p>
                {storeSettings.city}
                {storeSettings.state ? `/${storeSettings.state}` : ""}
                {storeSettings.zipCode ? ` - CEP ${displayCep(storeSettings.zipCode)}` : ""}
              </p>
            )}
            {storeSettings.phone && <p>Tel: {displayPhone(storeSettings.phone)}</p>}
          </div>

          {/* Sale Metadata */}
          <div className="space-y-0.5 border-b border-dashed border-gray-400 pb-2 text-[11px]">
            <div className="flex justify-between">
              <span>CUPOM NÃO FISCAL</span>
              <span className="font-bold">VENDA #{sale.code}</span>
            </div>
            <div className="flex justify-between text-gray-600">
              <span>Data: {formattedDate}</span>
            </div>
            <div className="flex justify-between text-gray-600">
              <span>Atendente: {sale.userName}</span>
            </div>
            <div className="flex justify-between text-gray-600">
              <span>Cliente: {sale.customerName}</span>
              {sale.customerDocument && <span>({displayDocument(sale.customerDocument)})</span>}
            </div>
          </div>

          {/* Items Header */}
          <div className="border-b border-gray-300 pb-1">
            <div className="grid grid-cols-12 text-[11px] font-bold">
              <span className="col-span-6">ITEM / PRODUTO</span>
              <span className="col-span-3 text-right">QTD x UN</span>
              <span className="col-span-3 text-right">VALOR</span>
            </div>
          </div>

          {/* Items List */}
          <div className="space-y-1.5 border-b border-dashed border-gray-400 py-1 text-[11px]">
            {sale.items.map((item, index) => (
              <div key={item.id || index} className="space-y-0.5">
                <div className="truncate font-medium">{item.productName}</div>
                <div className="grid grid-cols-12 text-[10px] text-gray-600">
                  <span className="col-span-6 font-mono text-[9px] text-gray-500">
                    #{index + 1}
                  </span>
                  <span className="col-span-3 text-right">
                    {formatNumber(item.quantity, ["UN", "CX"].includes(item.unit) ? 0 : 3)}{" "}
                    {item.unit} x {formatCurrency(item.unitPrice)}
                  </span>
                  <span className="col-span-3 text-right font-medium text-black">
                    {formatCurrency(item.subtotal)}
                  </span>
                </div>
              </div>
            ))}
          </div>

          {/* Totals */}
          <div className="space-y-1 border-b border-dashed border-gray-400 pt-1 pb-2 text-[11px]">
            {sale.discount > 0 && (
              <>
                <div className="flex justify-between text-gray-600">
                  <span>Subtotal:</span>
                  <span>{formatCurrency(sale.total + sale.discount)}</span>
                </div>
                <div className="text-destructive flex justify-between">
                  <span>Desconto:</span>
                  <span>- {formatCurrency(sale.discount)}</span>
                </div>
              </>
            )}

            <div className="flex justify-between pt-0.5 text-sm font-bold">
              <span>TOTAL R$:</span>
              <span>{formatCurrency(sale.total)}</span>
            </div>

            <div className="flex justify-between pt-1 text-gray-700">
              <span>Forma de Pagamento:</span>
              <span className="font-semibold">
                {paymentMethodLabels[sale.paymentMethod] || sale.paymentMethod}
              </span>
            </div>

            {sale.paymentMethod === "MONEY" && (
              <>
                <div className="flex justify-between text-gray-600">
                  <span>Valor Recebido:</span>
                  <span>{formatCurrency(sale.amountPaid)}</span>
                </div>
                <div className="flex justify-between font-semibold text-emerald-700">
                  <span>Troco:</span>
                  <span>{formatCurrency(sale.change)}</span>
                </div>
              </>
            )}
          </div>

          {/* Footer Note */}
          <div className="space-y-1 pt-2 text-center">
            <p className="text-[10px] text-gray-600 italic">
              {storeSettings.receiptFooterNote || "Obrigado pela preferência! Volte sempre."}
            </p>
            <p className="text-[9px] text-gray-400">Gestão de Lojas ERP/PDV v1.0</p>
          </div>
        </div>

        <DialogFooter className="flex flex-col gap-2 pt-2 sm:flex-row print:hidden">
          <Button variant="outline" onClick={handlePrint} className="flex-1">
            <Printer className="mr-2 h-4 w-4" /> Imprimir Recibo
          </Button>
          <Button onClick={() => onOpenChange(false)} className="flex-1">
            <ShoppingBag className="mr-2 h-4 w-4" /> Nova Venda
          </Button>
        </DialogFooter>

        {/* Global Print Styles */}
        <style jsx global>{`
          @media print {
            body * {
              visibility: hidden !important;
            }
            #receipt-print-area,
            #receipt-print-area * {
              visibility: visible !important;
            }
            #receipt-print-area {
              position: absolute !important;
              left: 0 !important;
              top: 0 !important;
              width: 100% !important;
              max-width: 80mm !important;
              margin: 0 auto !important;
              padding: 10px !important;
            }
          }
        `}</style>
      </DialogContent>
    </Dialog>
  );
}
