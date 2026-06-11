ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'wallet_pending';
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'payout_processing';
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'payout_failed';

ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "provider_cost" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "sale_total" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "provider_total" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "profit_total" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "wallet_status" TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "payout_status" TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "billing_period" TEXT;

UPDATE "orders"
SET
  "sale_total" = CASE WHEN "sale_total" = 0 THEN "total" ELSE "sale_total" END,
  "provider_total" = CASE WHEN "provider_total" = 0 THEN "total" ELSE "provider_total" END,
  "profit_total" = CASE WHEN "profit_total" = 0 THEN 0 ELSE "profit_total" END
WHERE "total" > 0;

CREATE TABLE IF NOT EXISTS "client_wallets" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "user_id" TEXT NOT NULL UNIQUE,
  "balance" INTEGER NOT NULL DEFAULT 0,
  "currency" TEXT NOT NULL DEFAULT 'COP',
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "client_wallets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "wallet_movements" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "wallet_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "order_id" TEXT,
  "type" TEXT NOT NULL,
  "amount" INTEGER NOT NULL,
  "balance_after" INTEGER NOT NULL,
  "description" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "wallet_movements_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "client_wallets"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "wallet_movements_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "provider_payouts" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "order_id" TEXT NOT NULL,
  "provider_id" TEXT,
  "amount" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'COP',
  "method" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "transaction_id" TEXT,
  "reference" TEXT,
  "receipt_text" TEXT,
  "raw_response" JSONB,
  "confirmed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "provider_payouts_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "orders_wallet_status_idx" ON "orders"("wallet_status");
CREATE INDEX IF NOT EXISTS "orders_payout_status_idx" ON "orders"("payout_status");
CREATE INDEX IF NOT EXISTS "orders_billing_period_idx" ON "orders"("billing_period");
CREATE INDEX IF NOT EXISTS "wallet_movements_wallet_id_idx" ON "wallet_movements"("wallet_id");
CREATE INDEX IF NOT EXISTS "wallet_movements_user_id_idx" ON "wallet_movements"("user_id");
CREATE INDEX IF NOT EXISTS "wallet_movements_order_id_idx" ON "wallet_movements"("order_id");
CREATE INDEX IF NOT EXISTS "wallet_movements_type_idx" ON "wallet_movements"("type");
CREATE INDEX IF NOT EXISTS "provider_payouts_order_id_idx" ON "provider_payouts"("order_id");
CREATE INDEX IF NOT EXISTS "provider_payouts_status_idx" ON "provider_payouts"("status");
CREATE INDEX IF NOT EXISTS "provider_payouts_transaction_id_idx" ON "provider_payouts"("transaction_id");
