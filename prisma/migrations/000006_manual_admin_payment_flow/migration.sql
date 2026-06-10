ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'admin_payment_pending';
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'provider_delivery_pending';

ALTER TABLE "provider_payouts" ADD COLUMN IF NOT EXISTS "admin_payment_reference" TEXT;
ALTER TABLE "provider_payouts" ADD COLUMN IF NOT EXISTS "admin_payment_notes" TEXT;
ALTER TABLE "provider_payouts" ADD COLUMN IF NOT EXISTS "admin_marked_by" TEXT;
ALTER TABLE "provider_payouts" ADD COLUMN IF NOT EXISTS "admin_marked_at" TIMESTAMP(3);
