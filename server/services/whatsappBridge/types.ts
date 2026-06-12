export type WhatsAppBridgeConnection = 'disabled' | 'disconnected' | 'connecting' | 'connected';

export type WhatsAppBridgeStatus = {
  enabled: boolean;
  mode: string;
  connection: WhatsAppBridgeConnection;
  connectedNumber?: string | null;
  qrPending: boolean;
  lastError?: string | null;
  pending: number;
  sent: number;
  failed: number;
  emailFallback: number;
};

export type QueueWhatsAppMessageInput = {
  recipient: string;
  message: string;
  orderId?: string;
  payoutId?: string;
};

export type AddMovement = (type: string, description: string, user_id?: string, order_id?: string) => Promise<void>;

export type WhatsAppOutboxFallbackResult = 'email' | 'whatsapp' | 'failed' | 'skipped';

export type WhatsAppOutboxFailureHandler = (item: {
  id: string;
  recipient: string;
  message: string;
  order_id: string | null;
  payout_id: string | null;
}) => Promise<WhatsAppOutboxFallbackResult>;

export type WhatsAppInboundPayload = {
  whatsappMessageId?: string;
  from: string;
  body: string;
  raw?: unknown;
};

export type WhatsAppInboundHandler = (payload: WhatsAppInboundPayload) => Promise<void>;
