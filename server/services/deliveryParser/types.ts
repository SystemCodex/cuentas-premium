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

export type DeliveryParserResult = {
  confidence: number;
  items: DeliveryParserItem[];
  warnings: string[];
};
