ALTER TABLE "provider_payouts" ADD COLUMN IF NOT EXISTS "destination_type" TEXT;
ALTER TABLE "provider_payouts" ADD COLUMN IF NOT EXISTS "destination_phone" TEXT;
ALTER TABLE "provider_payouts" ADD COLUMN IF NOT EXISTS "destination_document" TEXT;

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

CREATE INDEX IF NOT EXISTS "provider_payment_configs_provider_id_idx" ON "provider_payment_configs"("provider_id");
CREATE INDEX IF NOT EXISTS "provider_payment_configs_method_idx" ON "provider_payment_configs"("method");
CREATE INDEX IF NOT EXISTS "provider_payouts_reference_idx" ON "provider_payouts"("reference");
