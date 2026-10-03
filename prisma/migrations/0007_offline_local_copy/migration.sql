-- Cópia local dos dados do PDV (issue #36, docs/OFFLINE.md seções 3.1, 3.7 e 5):
-- exclusão lógica, unicidade só entre registros ativos, versão de sincronização e histórico de
-- preços. Compatível com os dados existentes: nada é excluído e todos os registros ficam ativos.

-- Unicidade só entre registros ativos: troca os índices únicos por índices únicos parciais.
-- O Prisma 6 não declara índice parcial no schema e o ignora ao comparar (migrate diff fica vazio).
DROP INDEX "Category_name_key";
DROP INDEX "Customer_document_key";
DROP INDEX "Product_barcode_key";
DROP INDEX "Product_sku_key";

-- AlterTable: updatedAt recebe a data da migration nas categorias existentes e depois fica sem
-- padrão no banco, como nos demais @updatedAt (o Prisma Client preenche)
ALTER TABLE "Category" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "syncVersion" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "Category" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "syncVersion" BIGINT NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "syncVersion" BIGINT NOT NULL DEFAULT 0;

-- CreateIndex: únicos parciais (só registros ativos)
CREATE UNIQUE INDEX "Category_name_active_key" ON "Category"("name") WHERE "deletedAt" IS NULL;
CREATE UNIQUE INDEX "Customer_document_active_key" ON "Customer"("document") WHERE "deletedAt" IS NULL;
CREATE UNIQUE INDEX "Product_barcode_active_key" ON "Product"("barcode") WHERE "deletedAt" IS NULL;
CREATE UNIQUE INDEX "Product_sku_active_key" ON "Product"("sku") WHERE "deletedAt" IS NULL;

-- CreateTable
CREATE TABLE "ProductPrice" (
    "id" BIGSERIAL NOT NULL,
    "productId" TEXT NOT NULL,
    "salePrice" DECIMAL(10,2) NOT NULL,
    "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductPrice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductPrice_productId_validFrom_idx" ON "ProductPrice"("productId", "validFrom");

-- CreateIndex
CREATE INDEX "Category_syncVersion_id_idx" ON "Category"("syncVersion", "id");

-- CreateIndex
CREATE INDEX "Customer_syncVersion_id_idx" ON "Customer"("syncVersion", "id");

-- CreateIndex
CREATE INDEX "Product_syncVersion_id_idx" ON "Product"("syncVersion", "id");

-- AddForeignKey
ALTER TABLE "ProductPrice" ADD CONSTRAINT "ProductPrice_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Versão de sincronização: id da transação que gravou a linha (pg_current_xact_id, 64 bits, nunca
-- reinicia). Preenchida pelo banco em todo INSERT/UPDATE, inclusive updateMany e SQL direto. A
-- leitura incremental só entrega versões abaixo de pg_snapshot_xmin(pg_current_snapshot()), ou seja,
-- de transações já encerradas: uma transação lenta que confirma depois da leitura nunca é pulada.
CREATE FUNCTION "set_sync_version"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW."syncVersion" := pg_current_xact_id()::text::bigint;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "Category_sync_version" BEFORE INSERT OR UPDATE ON "Category"
  FOR EACH ROW EXECUTE FUNCTION "set_sync_version"();
CREATE TRIGGER "Customer_sync_version" BEFORE INSERT OR UPDATE ON "Customer"
  FOR EACH ROW EXECUTE FUNCTION "set_sync_version"();
CREATE TRIGGER "Product_sync_version" BEFORE INSERT OR UPDATE ON "Product"
  FOR EACH ROW EXECUTE FUNCTION "set_sync_version"();

-- Registros existentes recebem a versão desta migration (o gatilho preenche no UPDATE)
UPDATE "Category" SET "syncVersion" = 0;
UPDATE "Customer" SET "syncVersion" = 0;
UPDATE "Product" SET "syncVersion" = 0;

-- Histórico de preços: uma linha no cadastro e a cada mudança de salePrice, com o instante (UTC)
-- do início da transação, igual para todas as linhas gravadas por ela
CREATE FUNCTION "record_product_price"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO "ProductPrice" ("productId", "salePrice", "validFrom")
  VALUES (NEW."id", NEW."salePrice", now() AT TIME ZONE 'UTC');
  RETURN NULL;
END;
$$;

CREATE TRIGGER "Product_price_insert" AFTER INSERT ON "Product"
  FOR EACH ROW EXECUTE FUNCTION "record_product_price"();
CREATE TRIGGER "Product_price_update" AFTER UPDATE OF "salePrice" ON "Product"
  FOR EACH ROW WHEN (OLD."salePrice" IS DISTINCT FROM NEW."salePrice")
  EXECUTE FUNCTION "record_product_price"();

-- Produtos existentes: o preço atual passa a valer a partir desta migration (não há histórico
-- anterior confiável)
INSERT INTO "ProductPrice" ("productId", "salePrice", "validFrom")
SELECT "id", "salePrice", now() AT TIME ZONE 'UTC' FROM "Product";
