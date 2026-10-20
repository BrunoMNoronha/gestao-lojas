-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "description" TEXT,
ADD COLUMN     "imageUrl" TEXT,
ADD COLUMN     "showInCatalog" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "StoreSettings" ADD COLUMN     "catalogEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "whatsappNumber" TEXT;
