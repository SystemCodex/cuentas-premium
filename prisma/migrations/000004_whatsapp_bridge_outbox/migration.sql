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

CREATE INDEX IF NOT EXISTS "whatsapp_outbox_status_idx" ON "whatsapp_outbox"("status");
CREATE INDEX IF NOT EXISTS "whatsapp_outbox_created_at_idx" ON "whatsapp_outbox"("created_at");
CREATE INDEX IF NOT EXISTS "whatsapp_outbox_order_id_idx" ON "whatsapp_outbox"("order_id");
