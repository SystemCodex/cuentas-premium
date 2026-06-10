ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "order_number" TEXT;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "admin_notified_at" TIMESTAMP(3);
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "provider_payment_marked_at" TIMESTAMP(3);
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "delivery_processed_at" TIMESTAMP(3);
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "delivered_at" TIMESTAMP(3);
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "client_notified_at" TIMESTAMP(3);

WITH numbered AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (PARTITION BY EXTRACT(YEAR FROM "created_at") ORDER BY "created_at", "id") AS seq,
    EXTRACT(YEAR FROM "created_at")::INT AS year
  FROM "orders"
  WHERE "order_number" IS NULL
)
UPDATE "orders"
SET "order_number" = 'ORD-' || numbered.year || '-' || LPAD(numbered.seq::TEXT, 6, '0')
FROM numbered
WHERE "orders"."id" = numbered."id";

ALTER TABLE "orders" ALTER COLUMN "order_number" SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "orders_order_number_key" ON "orders"("order_number");
CREATE INDEX IF NOT EXISTS "orders_order_number_idx" ON "orders"("order_number");
