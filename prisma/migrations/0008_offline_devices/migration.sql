-- Aparelhos habilitados para o PDV offline e autorizações offline (issue #37, docs/OFFLINE.md
-- seções 3.5 e 7). Só cria tabelas novas: nada muda nas existentes.

-- CreateTable
CREATE TABLE "OfflineDevice" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "registeredById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSyncAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revokedById" TEXT,

    CONSTRAINT "OfflineDevice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OfflineGrant" (
    "id" UUID NOT NULL,
    "deviceId" UUID NOT NULL,
    "userId" TEXT NOT NULL,
    "cashRegisterId" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OfflineGrant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OfflineGrant_deviceId_userId_issuedAt_idx" ON "OfflineGrant"("deviceId", "userId", "issuedAt");

-- AddForeignKey
ALTER TABLE "OfflineDevice" ADD CONSTRAINT "OfflineDevice_registeredById_fkey" FOREIGN KEY ("registeredById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfflineDevice" ADD CONSTRAINT "OfflineDevice_revokedById_fkey" FOREIGN KEY ("revokedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfflineGrant" ADD CONSTRAINT "OfflineGrant_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "OfflineDevice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfflineGrant" ADD CONSTRAINT "OfflineGrant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfflineGrant" ADD CONSTRAINT "OfflineGrant_cashRegisterId_fkey" FOREIGN KEY ("cashRegisterId") REFERENCES "CashRegister"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

