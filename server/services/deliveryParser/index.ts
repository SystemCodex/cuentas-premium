import { matchProductsToOrder } from './matchProductsToOrder.js';
import { parseRawDeliveryMessage } from './parseDeliveryMessage.js';
import type { DeliveryParserResult } from './types.js';

export function parseDeliveryMessage(rawText: string, order: any): DeliveryParserResult {
  const parsed = parseRawDeliveryMessage(rawText);
  const matched = matchProductsToOrder(parsed.items, order);
  return {
    confidence: parsed.confidence,
    items: matched.items,
    warnings: [...parsed.warnings, ...matched.warnings]
  };
}

export type { DeliveryParserItem, DeliveryParserResult } from './types.js';
