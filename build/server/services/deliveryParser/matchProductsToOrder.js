import { deliveryServiceFromText } from './serviceAliases.js';
export function matchProductsToOrder(items, order) {
    const warnings = [];
    const used = new Set();
    const matched = items.map((item) => {
        const detected = deliveryServiceFromText(item.serviceName);
        const matches = (order.items || []).filter((orderItem) => {
            const service = deliveryServiceFromText(`${orderItem.product_name} ${orderItem.product?.brand_key || ''}`);
            return detected?.key && service?.key === detected.key;
        });
        const availableMatches = matches.filter((match) => !used.has(match.id));
        const selected = availableMatches.length === 1 ? availableMatches[0] : availableMatches[0] || matches[0];
        if (!selected) {
            const reason = 'Este servicio no pertenece a la orden seleccionada.';
            warnings.push(`${item.serviceName}: producto no compatible con la orden seleccionada.`);
            return { ...item, needsReview: true, incompatible: true, incompatibleReason: reason };
        }
        if (matches.length > 1)
            warnings.push(`${item.serviceName}: hay varios productos similares en el pedido.`);
        used.add(selected.id);
        return {
            ...item,
            matchedProductId: selected.product_id,
            matchedOrderItemId: selected.id,
            needsReview: item.needsReview || matches.length > 1
        };
    });
    return { items: matched, warnings };
}
