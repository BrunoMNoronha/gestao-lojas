-- Campos nulos preservam o cadastro existente. Uma caixa CX tem uma única origem UN.
ALTER TABLE "Product" ADD COLUMN "containedProductId" TEXT, ADD COLUMN "unitsPerBox" INTEGER;
CREATE UNIQUE INDEX "Product_containedProductId_key" ON "Product"("containedProductId");
ALTER TABLE "Product" ADD CONSTRAINT "Product_containedProductId_fkey"
  FOREIGN KEY ("containedProductId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Product" ADD CONSTRAINT "Product_box_contents_check" CHECK (
  ("containedProductId" IS NULL AND "unitsPerBox" IS NULL) OR
  ("containedProductId" IS NOT NULL AND "unitsPerBox" IS NOT NULL AND "unit" = 'CX'
   AND "unitsPerBox" BETWEEN 2 AND 1000000 AND "containedProductId" <> "id")
);

CREATE TABLE "UnpackConversion" (
  "id" UUID NOT NULL,
  "payloadHash" TEXT NOT NULL,
  "boxProductId" TEXT NOT NULL,
  "unitProductId" TEXT NOT NULL,
  "boxProductName" TEXT NOT NULL,
  "unitProductName" TEXT NOT NULL,
  "unitsPerBox" INTEGER NOT NULL,
  "boxQuantity" INTEGER NOT NULL,
  "unitQuantity" INTEGER NOT NULL,
  "boxUnitCost" DECIMAL(10,2) NOT NULL,
  "totalCost" DECIMAL(18,2) NOT NULL,
  "unitCostBase" DECIMAL(10,2) NOT NULL,
  "extraCostUnits" INTEGER NOT NULL,
  "appliedTxid" BIGINT NOT NULL,
  "userId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UnpackConversion_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "UnpackConversion_quantities_check" CHECK (
    "unitsPerBox" >= 2 AND "boxQuantity" > 0 AND "unitQuantity" = "boxQuantity" * "unitsPerBox"
    AND "extraCostUnits" >= 0 AND "extraCostUnits" < "unitQuantity"
  ),
  CONSTRAINT "UnpackConversion_cost_check" CHECK (
    "boxUnitCost" >= 0 AND "unitCostBase" >= 0
    AND "totalCost" = "boxQuantity" * "boxUnitCost"
    AND "totalCost" = "unitQuantity" * "unitCostBase" + "extraCostUnits" * 0.01
  ),
  CONSTRAINT "UnpackConversion_boxProductId_fkey" FOREIGN KEY ("boxProductId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "UnpackConversion_unitProductId_fkey" FOREIGN KEY ("unitProductId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "UnpackConversion_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "UnpackConversion_boxProductId_createdAt_idx" ON "UnpackConversion"("boxProductId", "createdAt");
CREATE INDEX "UnpackConversion_unitProductId_createdAt_idx" ON "UnpackConversion"("unitProductId", "createdAt");
CREATE INDEX "UnpackConversion_userId_createdAt_idx" ON "UnpackConversion"("userId", "createdAt");

ALTER TABLE "StockMovement" ADD COLUMN "totalCost" DECIMAL(18,2), ADD COLUMN "conversionId" UUID;
CREATE INDEX "StockMovement_conversionId_idx" ON "StockMovement"("conversionId");
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_conversionId_fkey"
  FOREIGN KEY ("conversionId") REFERENCES "UnpackConversion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
