export type Role = "client" | "provider" | "admin";
export type OrderStatus = "admin_payment_pending" | "provider_delivery_pending" | "wallet_pending" | "payout_processing" | "pending_payment" | "paid" | "pending" | "processing" | "delivered" | "payout_failed" | "payment_failed" | "cancelled";

export type User = {
  id: string;
  name: string;
  email: string;
  role: Role;
  phone?: string | null;
  created_at: string;
};

export type Product = {
  id: string;
  name: string;
  description: string;
  category: string;
  price: number;
  provider_cost?: number;
  active: boolean;
  brand_key: string;
  duration?: string | null;
  screens?: string | null;
  content_type?: string | null;
  benefits?: string[];
};

export type CartItem = {
  product: Product;
  quantity: number;
};

export type DeliveredAccount = {
  id: string;
  order_id: string;
  order_item_id: string;
  product_id: string;
  delivered_email: string;
  delivered_password: string;
  profile_name?: string | null;
  pin?: string | null;
  notes?: string | null;
  delivered_at: string;
};

export type OrderItem = {
  id: string;
  product_id: string;
  product_name: string;
  quantity: number;
  unit_price?: number;
  subtotal?: number;
  delivered_quantity?: number;
  pending_quantity?: number;
  delivered_accounts: DeliveredAccount[];
};

export type Order = {
  id: string;
  order_number: string;
  user_id: string;
  provider_id?: string | null;
  total: number;
  sale_total?: number;
  provider_total?: number;
  profit_total?: number;
  status: OrderStatus;
  wallet_status?: string;
  payout_status?: string;
  billing_period?: string | null;
  payment_status: "pending" | "confirmed" | "failed" | "refunded" | string;
  payment_method?: string | null;
  payment_reference?: string | null;
  payment_provider?: string | null;
  payment_amount?: number | null;
  payment_confirmed_at?: string | null;
  whatsapp_sent: boolean;
  admin_notified_at?: string | null;
  admin_notification_channel?: string | null;
  provider_payment_marked_at?: string | null;
  delivery_processed_at?: string | null;
  delivered_at?: string | null;
  client_notified_at?: string | null;
  created_at: string;
  updated_at: string;
  user?: User;
  provider?: User | null;
  items: OrderItem[];
  movements?: Movement[];
  payments?: Payment[];
  providerPayouts?: ProviderPayout[];
};

export type ProviderPayout = {
  id: string;
  order_id: string;
  amount: number;
  currency: string;
  method: string;
  status: string;
  transaction_id?: string | null;
  reference?: string | null;
  destination_type?: string | null;
  destination_phone?: string | null;
  confirmed_at?: string | null;
  created_at: string;
  order?: { id: string; order_number?: string; user?: User | null; sale_total?: number; provider_total?: number; profit_total?: number; status: OrderStatus; items?: OrderItem[] };
};

export type ProviderDelivery = {
  id: string;
  order_id: string;
  order_number?: string;
  order_item_id: string;
  product_id: string;
  product_name: string;
  client_name: string;
  status: OrderStatus;
  delivered_email?: string | null;
  profile_name?: string | null;
  pin?: string | null;
  notes?: string | null;
  delivered_at: string;
};

export type ParsedDeliveryAccount = {
  service: string;
  delivered_email?: string;
  delivered_user?: string;
  delivered_password?: string;
  profile_name?: string;
  pin?: string;
  notes?: string;
  iptv_url?: string;
};

export type DeliveryDraft = {
  id: string;
  inbound_message_id?: string | null;
  order_id?: string | null;
  status: string;
  confidence: number;
  raw_text: string;
  parsed_data: { orderHint?: string; confidence?: number; accounts?: ParsedDeliveryAccount[]; items?: DeliveryParserItem[]; normalizedText?: string; warnings?: string[] };
  review_notes?: string | null;
  created_at: string;
  updated_at: string;
  inbound?: { id: string; from: string; status: string; created_at: string } | null;
  order?: Order | null;
};

export type WhatsAppInboundMessage = {
  id: string;
  from: string;
  body_preview: string;
  status: string;
  created_at: string;
};

export type DeliveryParserItem = {
  serviceName: string;
  matchedProductId?: string;
  matchedOrderItemId?: string;
  delivered_email?: string;
  delivered_user?: string;
  delivered_password?: string;
  profile_name?: string;
  pin?: string;
  iptv_url?: string;
  notes?: string;
  confidence: number;
  needsReview: boolean;
  incompatible?: boolean;
  incompatibleReason?: string;
};

export type DeliveryParserPreview = {
  confidence: number;
  items: DeliveryParserItem[];
  warnings: string[];
};

export type Notification = {
  id: string;
  user_id: string;
  order_id?: string | null;
  type: string;
  title: string;
  message: string;
  read: boolean;
  read_at?: string | null;
  created_at: string;
};

export type Payment = {
  id: string;
  order_id: string;
  provider: string;
  method: string;
  status: "pending" | "confirmed" | "failed" | "refunded" | string;
  amount: number;
  currency: string;
  transaction_id?: string | null;
  reference?: string | null;
  receipt_status?: "sent" | "failed" | "pending" | string;
  confirmed_at?: string | null;
  created_at: string;
  order?: Pick<Order, "id" | "total" | "status"> & { user?: User | null };
};

export type Movement = {
  id: string;
  type: string;
  description: string;
  created_at: string;
  user?: User | null;
  order?: Order | null;
};

export type SystemLog = {
  id: string;
  source: "whatsapp" | "movement";
  type: string;
  status?: string;
  description: string;
  order_label?: string | null;
  attempts?: number;
  last_error?: string | null;
  created_at: string;
  updated_at?: string;
};

export type Dashboard = {
  totalSold: number;
  totalProviderPaid: number;
  totalProfit: number;
  todaySold: number;
  todayOrders: number;
  payoutProcessingOrders: number;
  pendingPaymentOrders: number;
  pendingOrders: number;
  processingOrders: number;
  deliveredOrders: number;
  payoutFailedOrders: number;
  paymentFailedOrders: number;
  cancelledOrders: number;
  pendingPayments: number;
  confirmedPayments: number;
  failedPayments: number;
  receiptSent: number;
  receiptFailed: number;
  providerPayoutConfirmed: number;
  providerPayoutPending: number;
  providerPayoutFailed: number;
  usersCount: number;
  activeProducts: number;
  deliveredAccounts: number;
  notificationSent: number;
  notificationPending: number;
  notificationFailed: number;
  deliveryDraftsPending: number;
  whatsappInboundReceived: number;
  whatsappInboundAutoDelivered: number;
  whatsappInboundDrafts: number;
  whatsappInboundFailed: number;
  lastProviderNotified?: string | null;
  recentOrders: Order[];
  latestPayments: Payment[];
  providerPayouts: ProviderPayout[];
  monthlyStatements: Array<{ month: string; client: User; totalSold: number; totalProviderPaid: number; profit: number; orders: number; status: string }>;
  movements: Movement[];
};

export type ProviderConfig = {
  provider_name: string;
  provider_whatsapp_number: string;
  admin_notification_phone?: string;
  admin_notification_email?: string;
  provider_notifications_active: boolean;
  provider_notification_method: "bridge" | "internal";
  bridge_configured: boolean;
  provider_payment_method: "nequi" | "daviplata" | "bancolombia";
  provider_payment_phone: string;
  provider_document?: string | null;
  provider_payment_active: boolean;
  latest_payout_status?: string | null;
  failed_payouts?: number;
};

export type WhatsAppBridgeStatus = {
  enabled: boolean;
  mode: string;
  connection: "disabled" | "disconnected" | "connecting" | "connected";
  connectedNumber?: string | null;
  qrPending: boolean;
  lastError?: string | null;
  pending: number;
  sent: number;
  failed: number;
};

export type EmailStatus = {
  configured: boolean;
  source: "database" | "environment";
  host: string;
  port: number;
  secure: boolean;
  user: string;
  from: string;
  passwordConfigured: boolean;
  recipient: string;
  lastTestStatus?: "pending" | "sent" | "failed" | "";
  lastTestAt?: string;
  lastError?: string;
};
