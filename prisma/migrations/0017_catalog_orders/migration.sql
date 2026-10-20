-- Pedidos do catálogo público (issue #81): gerados quando um usuário logado abre o link do pedido
-- enviado pelo WhatsApp, com número, chave de idempotência, itens como estavam no pedido e vínculo
-- opcional com a venda que o concluiu. Sem dados pessoais. Aditiva: vendas antigas não mudam.

-- CreateEnum
CREATE TYPE "CatalogOrderStatus" AS ENUM ('OPEN', 'CANCELED', 'CONVERTED');

-- CreateTable
CREATE TABLE "CatalogOrder" (
    "id" TEXT NOT NULL,
    "code" SERIAL NOT NULL,
    "requestKey" UUID NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "status" "CatalogOrderStatus" NOT NULL DEFAULT 'OPEN',
    "createdById" TEXT NOT NULL,
    "estimatedTotal" DECIMAL(10,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "canceledAt" TIMESTAMP(3),
    "canceledById" TEXT,
    "cancelReason" TEXT,
    "saleId" TEXT,
    "convertedAt" TIMESTAMP(3),
    "convertedById" TEXT,

    CONSTRAINT "CatalogOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CatalogOrderItem" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "productId" TEXT,
    "productName" TEXT NOT NULL,
    "unit" "Unit" NOT NULL,
    "quantity" DECIMAL(10,3) NOT NULL,
    "unitPrice" DECIMAL(10,2) NOT NULL,
    "subtotal" DECIMAL(10,2) NOT NULL,

    CONSTRAINT "CatalogOrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CatalogOrder_code_key" ON "CatalogOrder"("code");

-- CreateIndex
CREATE UNIQUE INDEX "CatalogOrder_requestKey_key" ON "CatalogOrder"("requestKey");

-- CreateIndex
CREATE UNIQUE INDEX "CatalogOrder_saleId_key" ON "CatalogOrder"("saleId");

-- CreateIndex
CREATE INDEX "CatalogOrder_status_createdAt_idx" ON "CatalogOrder"("status", "createdAt");

-- CreateIndex
CREATE INDEX "CatalogOrder_createdAt_idx" ON "CatalogOrder"("createdAt");

-- CreateIndex
CREATE INDEX "CatalogOrderItem_orderId_idx" ON "CatalogOrderItem"("orderId");

-- CreateIndex
CREATE INDEX "CatalogOrderItem_productId_idx" ON "CatalogOrderItem"("productId");

-- AddForeignKey
ALTER TABLE "CatalogOrder" ADD CONSTRAINT "CatalogOrder_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogOrder" ADD CONSTRAINT "CatalogOrder_canceledById_fkey" FOREIGN KEY ("canceledById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogOrder" ADD CONSTRAINT "CatalogOrder_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogOrder" ADD CONSTRAINT "CatalogOrder_convertedById_fkey" FOREIGN KEY ("convertedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogOrderItem" ADD CONSTRAINT "CatalogOrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "CatalogOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogOrderItem" ADD CONSTRAINT "CatalogOrderItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

