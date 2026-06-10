DO $$ BEGIN
  CREATE TYPE "Role" AS ENUM ('client', 'provider', 'admin');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "OrderStatus" AS ENUM ('admin_payment_pending', 'provider_delivery_pending', 'wallet_pending', 'payout_processing', 'pending_payment', 'paid', 'pending', 'processing', 'delivered', 'payout_failed', 'payment_failed', 'cancelled');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'admin_payment_pending';
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'provider_delivery_pending';

CREATE TABLE IF NOT EXISTS "users" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "email" TEXT NOT NULL UNIQUE,
  "access_code" TEXT UNIQUE,
  "password_hash" TEXT NOT NULL,
  "role" "Role" NOT NULL DEFAULT 'client',
  "phone" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "access_code" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "users_access_code_key" ON "users"("access_code");

CREATE TABLE IF NOT EXISTS "products" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL UNIQUE,
  "description" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "price" INTEGER NOT NULL,
  "provider_cost" INTEGER NOT NULL DEFAULT 0,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "brand_key" TEXT NOT NULL DEFAULT 'netflix',
  "duration" TEXT,
  "screens" TEXT,
  "content_type" TEXT,
  "benefits" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "duration" TEXT;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "screens" TEXT;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "content_type" TEXT;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "benefits" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "provider_cost" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS "orders" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "order_number" TEXT NOT NULL UNIQUE,
  "user_id" TEXT NOT NULL,
  "provider_id" TEXT,
  "total" INTEGER NOT NULL,
  "sale_total" INTEGER NOT NULL DEFAULT 0,
  "provider_total" INTEGER NOT NULL DEFAULT 0,
  "profit_total" INTEGER NOT NULL DEFAULT 0,
  "status" "OrderStatus" NOT NULL DEFAULT 'pending_payment',
  "wallet_status" TEXT NOT NULL DEFAULT 'pending',
  "payout_status" TEXT NOT NULL DEFAULT 'pending',
  "billing_period" TEXT,
  "payment_status" TEXT NOT NULL DEFAULT 'pending',
  "payment_method" TEXT,
  "payment_reference" TEXT,
  "payment_provider" TEXT,
  "payment_amount" INTEGER,
  "payment_confirmed_at" TIMESTAMP(3),
  "payment_receipt_url" TEXT,
  "whatsapp_sent" BOOLEAN NOT NULL DEFAULT false,
  "admin_notified_at" TIMESTAMP(3),
  "admin_notification_channel" TEXT,
  "provider_payment_marked_at" TIMESTAMP(3),
  "delivery_processed_at" TIMESTAMP(3),
  "delivered_at" TIMESTAMP(3),
  "client_notified_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "orders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "orders_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "payment_status" TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "payment_method" TEXT;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "payment_reference" TEXT;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "payment_provider" TEXT;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "payment_amount" INTEGER;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "payment_confirmed_at" TIMESTAMP(3);
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "payment_receipt_url" TEXT;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "sale_total" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "provider_total" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "profit_total" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "wallet_status" TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "payout_status" TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "billing_period" TEXT;

CREATE TABLE IF NOT EXISTS "order_items" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "order_id" TEXT NOT NULL,
  "product_id" TEXT NOT NULL,
  "product_name" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL,
  "unit_price" INTEGER NOT NULL,
  "subtotal" INTEGER NOT NULL,
  CONSTRAINT "order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "order_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "delivered_accounts" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "order_id" TEXT NOT NULL,
  "order_item_id" TEXT NOT NULL,
  "product_id" TEXT NOT NULL,
  "delivered_email" TEXT,
  "delivered_password" TEXT,
  "profile_name" TEXT,
  "pin" TEXT,
  "notes" TEXT,
  "delivered_by" TEXT NOT NULL,
  "delivered_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "delivered_accounts_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "delivered_accounts_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "order_items"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "delivered_accounts_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "delivered_accounts_delivered_by_fkey" FOREIGN KEY ("delivered_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "movements" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "user_id" TEXT,
  "order_id" TEXT,
  "type" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "movements_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "movements_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

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
  "admin_payment_reference" TEXT,
  "admin_payment_notes" TEXT,
  "admin_marked_by" TEXT,
  "admin_marked_at" TIMESTAMP(3),
  "destination_type" TEXT,
  "destination_phone" TEXT,
  "destination_document" TEXT,
  "receipt_text" TEXT,
  "raw_response" JSONB,
  "confirmed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "provider_payouts_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

ALTER TABLE "provider_payouts" ADD COLUMN IF NOT EXISTS "destination_type" TEXT;
ALTER TABLE "provider_payouts" ADD COLUMN IF NOT EXISTS "destination_phone" TEXT;
ALTER TABLE "provider_payouts" ADD COLUMN IF NOT EXISTS "destination_document" TEXT;
ALTER TABLE "provider_payouts" ADD COLUMN IF NOT EXISTS "admin_payment_reference" TEXT;
ALTER TABLE "provider_payouts" ADD COLUMN IF NOT EXISTS "admin_payment_notes" TEXT;
ALTER TABLE "provider_payouts" ADD COLUMN IF NOT EXISTS "admin_marked_by" TEXT;
ALTER TABLE "provider_payouts" ADD COLUMN IF NOT EXISTS "admin_marked_at" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "provider_payment_configs" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "provider_id" TEXT,
  "method" TEXT NOT NULL,
  "phone" TEXT NOT NULL,
  "document" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "provider_payment_configs_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "whatsapp_outbox" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "recipient" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "last_error" TEXT,
  "order_id" TEXT,
  "payout_id" TEXT UNIQUE,
  "sent_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "notifications" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "user_id" TEXT NOT NULL,
  "order_id" TEXT,
  "type" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "read" BOOLEAN NOT NULL DEFAULT false,
  "read_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "notifications_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "app_settings" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "key" TEXT NOT NULL UNIQUE,
  "value" TEXT NOT NULL,
  "private" BOOLEAN NOT NULL DEFAULT true,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "whatsapp_inbound_messages" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "whatsapp_message_id" TEXT UNIQUE,
  "from" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "raw_payload" JSONB,
  "status" TEXT NOT NULL DEFAULT 'received',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "delivery_drafts" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "inbound_message_id" TEXT,
  "order_id" TEXT,
  "status" TEXT NOT NULL DEFAULT 'needs_review',
  "confidence" INTEGER NOT NULL DEFAULT 0,
  "raw_text" TEXT NOT NULL,
  "parsed_data" JSONB NOT NULL,
  "review_notes" TEXT,
  "created_by" TEXT,
  "approved_by" TEXT,
  "approved_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "orders_user_id_idx" ON "orders"("user_id");
CREATE INDEX IF NOT EXISTS "orders_order_number_idx" ON "orders"("order_number");
CREATE INDEX IF NOT EXISTS "orders_provider_id_idx" ON "orders"("provider_id");
CREATE INDEX IF NOT EXISTS "orders_status_idx" ON "orders"("status");
CREATE INDEX IF NOT EXISTS "orders_payment_status_idx" ON "orders"("payment_status");
CREATE INDEX IF NOT EXISTS "orders_wallet_status_idx" ON "orders"("wallet_status");
CREATE INDEX IF NOT EXISTS "orders_payout_status_idx" ON "orders"("payout_status");
CREATE INDEX IF NOT EXISTS "orders_billing_period_idx" ON "orders"("billing_period");
CREATE INDEX IF NOT EXISTS "orders_created_at_idx" ON "orders"("created_at");
CREATE INDEX IF NOT EXISTS "order_items_order_id_idx" ON "order_items"("order_id");
CREATE INDEX IF NOT EXISTS "order_items_product_id_idx" ON "order_items"("product_id");
CREATE INDEX IF NOT EXISTS "delivered_accounts_order_id_idx" ON "delivered_accounts"("order_id");
CREATE INDEX IF NOT EXISTS "delivered_accounts_order_item_id_idx" ON "delivered_accounts"("order_item_id");
CREATE INDEX IF NOT EXISTS "delivered_accounts_product_id_idx" ON "delivered_accounts"("product_id");
CREATE INDEX IF NOT EXISTS "delivered_accounts_delivered_by_idx" ON "delivered_accounts"("delivered_by");
CREATE INDEX IF NOT EXISTS "movements_created_at_idx" ON "movements"("created_at");
CREATE INDEX IF NOT EXISTS "movements_order_id_idx" ON "movements"("order_id");
CREATE INDEX IF NOT EXISTS "movements_user_id_idx" ON "movements"("user_id");
CREATE INDEX IF NOT EXISTS "movements_type_idx" ON "movements"("type");
CREATE INDEX IF NOT EXISTS "products_active_idx" ON "products"("active");
CREATE INDEX IF NOT EXISTS "products_category_idx" ON "products"("category");
CREATE INDEX IF NOT EXISTS "users_role_idx" ON "users"("role");
CREATE INDEX IF NOT EXISTS "payments_order_id_idx" ON "payments"("order_id");
CREATE INDEX IF NOT EXISTS "payments_status_idx" ON "payments"("status");
CREATE INDEX IF NOT EXISTS "payments_transaction_id_idx" ON "payments"("transaction_id");
CREATE INDEX IF NOT EXISTS "wallet_movements_wallet_id_idx" ON "wallet_movements"("wallet_id");
CREATE INDEX IF NOT EXISTS "wallet_movements_user_id_idx" ON "wallet_movements"("user_id");
CREATE INDEX IF NOT EXISTS "wallet_movements_order_id_idx" ON "wallet_movements"("order_id");
CREATE INDEX IF NOT EXISTS "wallet_movements_type_idx" ON "wallet_movements"("type");
CREATE INDEX IF NOT EXISTS "provider_payouts_order_id_idx" ON "provider_payouts"("order_id");
CREATE INDEX IF NOT EXISTS "provider_payouts_status_idx" ON "provider_payouts"("status");
CREATE INDEX IF NOT EXISTS "provider_payouts_transaction_id_idx" ON "provider_payouts"("transaction_id");
CREATE INDEX IF NOT EXISTS "provider_payouts_reference_idx" ON "provider_payouts"("reference");
CREATE INDEX IF NOT EXISTS "provider_payment_configs_provider_id_idx" ON "provider_payment_configs"("provider_id");
CREATE INDEX IF NOT EXISTS "provider_payment_configs_method_idx" ON "provider_payment_configs"("method");
CREATE INDEX IF NOT EXISTS "whatsapp_outbox_status_idx" ON "whatsapp_outbox"("status");
CREATE INDEX IF NOT EXISTS "whatsapp_outbox_created_at_idx" ON "whatsapp_outbox"("created_at");
CREATE INDEX IF NOT EXISTS "whatsapp_outbox_order_id_idx" ON "whatsapp_outbox"("order_id");
CREATE INDEX IF NOT EXISTS "whatsapp_inbound_messages_from_idx" ON "whatsapp_inbound_messages"("from");
CREATE INDEX IF NOT EXISTS "whatsapp_inbound_messages_status_idx" ON "whatsapp_inbound_messages"("status");
CREATE INDEX IF NOT EXISTS "whatsapp_inbound_messages_created_at_idx" ON "whatsapp_inbound_messages"("created_at");
CREATE INDEX IF NOT EXISTS "delivery_drafts_order_id_idx" ON "delivery_drafts"("order_id");
CREATE INDEX IF NOT EXISTS "delivery_drafts_status_idx" ON "delivery_drafts"("status");
CREATE INDEX IF NOT EXISTS "delivery_drafts_created_at_idx" ON "delivery_drafts"("created_at");
CREATE INDEX IF NOT EXISTS "notifications_user_id_idx" ON "notifications"("user_id");
CREATE INDEX IF NOT EXISTS "notifications_order_id_idx" ON "notifications"("order_id");
CREATE INDEX IF NOT EXISTS "notifications_read_idx" ON "notifications"("read");
CREATE INDEX IF NOT EXISTS "notifications_created_at_idx" ON "notifications"("created_at");
