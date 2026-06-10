CREATE TABLE IF NOT EXISTS "whatsapp_inbound_messages" (
  "id" TEXT NOT NULL,
  "whatsapp_message_id" TEXT,
  "from" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "raw_payload" JSONB,
  "status" TEXT NOT NULL DEFAULT 'received',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "whatsapp_inbound_messages_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "whatsapp_inbound_messages_whatsapp_message_id_key" ON "whatsapp_inbound_messages"("whatsapp_message_id");
CREATE INDEX IF NOT EXISTS "whatsapp_inbound_messages_from_idx" ON "whatsapp_inbound_messages"("from");
CREATE INDEX IF NOT EXISTS "whatsapp_inbound_messages_status_idx" ON "whatsapp_inbound_messages"("status");
CREATE INDEX IF NOT EXISTS "whatsapp_inbound_messages_created_at_idx" ON "whatsapp_inbound_messages"("created_at");

CREATE TABLE IF NOT EXISTS "delivery_drafts" (
  "id" TEXT NOT NULL,
  "inbound_message_id" TEXT,
  "order_id" TEXT,
  "status" TEXT NOT NULL DEFAULT 'needs_review',
  "confidence" INTEGER NOT NULL DEFAULT 0,
  "raw_text" TEXT NOT NULL,
  "parsed_data" JSONB NOT NULL,
  "review_notes" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "delivery_drafts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "delivery_drafts_order_id_idx" ON "delivery_drafts"("order_id");
CREATE INDEX IF NOT EXISTS "delivery_drafts_status_idx" ON "delivery_drafts"("status");
CREATE INDEX IF NOT EXISTS "delivery_drafts_created_at_idx" ON "delivery_drafts"("created_at");
