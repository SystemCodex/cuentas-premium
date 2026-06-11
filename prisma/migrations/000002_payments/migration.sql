ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'pending_payment';
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'paid';
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'payment_failed';

ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "payment_status" TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "payment_method" TEXT;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "payment_reference" TEXT;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "payment_provider" TEXT;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "payment_amount" INTEGER;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "payment_confirmed_at" TIMESTAMP(3);
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "payment_receipt_url" TEXT;
CREATE TABLE IF NOT EXISTS "payments" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "order_id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "method" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "amount" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'COP',
  "transaction_id" TEXT,
  "reference" TEXT,
  "raw_response" JSONB,
  "confirmed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "payments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "orders_payment_status_idx" ON "orders"("payment_status");
CREATE INDEX IF NOT EXISTS "payments_order_id_idx" ON "payments"("order_id");
CREATE INDEX IF NOT EXISTS "payments_status_idx" ON "payments"("status");
CREATE INDEX IF NOT EXISTS "payments_transaction_id_idx" ON "payments"("transaction_id");
