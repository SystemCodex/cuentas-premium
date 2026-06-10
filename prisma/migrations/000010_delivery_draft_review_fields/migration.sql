ALTER TABLE "delivery_drafts" ADD COLUMN IF NOT EXISTS "created_by" TEXT;
ALTER TABLE "delivery_drafts" ADD COLUMN IF NOT EXISTS "approved_by" TEXT;
ALTER TABLE "delivery_drafts" ADD COLUMN IF NOT EXISTS "approved_at" TIMESTAMP(3);
