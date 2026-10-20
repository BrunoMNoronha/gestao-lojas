-- CreateEnum
CREATE TYPE "PersonType" AS ENUM ('INDIVIDUAL', 'COMPANY');

-- AlterTable
ALTER TABLE "StoreSettings" ADD COLUMN     "personType" "PersonType" NOT NULL DEFAULT 'COMPANY';

-- Normalização dos dados existentes (issue #28): CPF/CNPJ, telefone e CEP passam a ser gravados
-- sem pontuação e formatados só na exibição. Só remove pontuação de valores com formato
-- reconhecível; o resto fica como está. CNPJ aceita o formato alfanumérico (12 posições A-Z/0-9
-- + 2 dígitos verificadores).

-- Loja: documento, telefone e CEP
UPDATE "StoreSettings"
SET "document" = regexp_replace(upper("document"), '[^0-9A-Z]', '', 'g')
WHERE regexp_replace(upper("document"), '[^0-9A-Z]', '', 'g') ~ '^([0-9]{11}|[0-9A-Z]{12}[0-9]{2})$';

-- Loja com CPF já salvo abre como Pessoa Física (no formulário de PJ o CPF seria inválido)
UPDATE "StoreSettings" SET "personType" = 'INDIVIDUAL' WHERE "document" ~ '^[0-9]{11}$';

UPDATE "StoreSettings"
SET "phone" = regexp_replace("phone", '[^0-9]', '', 'g')
WHERE regexp_replace("phone", '[^0-9]', '', 'g') ~ '^[0-9]{10,11}$';

UPDATE "StoreSettings"
SET "zipCode" = regexp_replace("zipCode", '[^0-9]', '', 'g')
WHERE regexp_replace("zipCode", '[^0-9]', '', 'g') ~ '^[0-9]{8}$';

-- Clientes e fornecedores: o documento é único, então só normaliza quando o valor sem pontuação
-- não colide com outro registro (nem com outro que normalizaria para o mesmo valor).
WITH normalized AS (
  SELECT "id", regexp_replace(upper("document"), '[^0-9A-Z]', '', 'g') AS doc
  FROM "Customer"
  WHERE "document" IS NOT NULL
)
UPDATE "Customer" c
SET "document" = n.doc
FROM normalized n
WHERE c."id" = n."id"
  AND c."document" <> n.doc
  AND n.doc ~ '^([0-9]{11}|[0-9A-Z]{12}[0-9]{2})$'
  AND (SELECT count(*) FROM normalized o WHERE o.doc = n.doc) = 1;

UPDATE "Customer"
SET "phone" = regexp_replace("phone", '[^0-9]', '', 'g')
WHERE regexp_replace("phone", '[^0-9]', '', 'g') ~ '^[0-9]{10,11}$';

WITH normalized AS (
  SELECT "id", regexp_replace(upper("document"), '[^0-9A-Z]', '', 'g') AS doc
  FROM "Supplier"
  WHERE "document" IS NOT NULL
)
UPDATE "Supplier" s
SET "document" = n.doc
FROM normalized n
WHERE s."id" = n."id"
  AND s."document" <> n.doc
  AND n.doc ~ '^([0-9]{11}|[0-9A-Z]{12}[0-9]{2})$'
  AND (SELECT count(*) FROM normalized o WHERE o.doc = n.doc) = 1;

UPDATE "Supplier"
SET "phone" = regexp_replace("phone", '[^0-9]', '', 'g')
WHERE regexp_replace("phone", '[^0-9]', '', 'g') ~ '^[0-9]{10,11}$';
