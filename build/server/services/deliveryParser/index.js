import { matchProductsToOrder } from './matchProductsToOrder.js';
import { parseRawDeliveryMessage } from './parseDeliveryMessage.js';
export function parseDeliveryMessage(rawText, order) {
    const parsed = parseRawDeliveryMessage(rawText);
    const matched = matchProductsToOrder(parsed.items, order);
    return {
        confidence: parsed.confidence,
        items: matched.items,
        warnings: [...parsed.warnings, ...matched.warnings]
    };
}
