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

export type ParsedAccountMessage = {
  orderHint?: string;
  confidence: number;
  accounts: ParsedDeliveryAccount[];
  normalizedText: string;
};
