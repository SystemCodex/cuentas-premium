import { sendSmtpEmail } from './smtpEmail.js';
export function buildAdminOrderEmail(order, payout, money, formatDateTime) {
    const text = [
        'NUEVO PEDIDO PENDIENTE',
        '',
        `Orden: ${order.order_number}`,
        `Fecha: ${formatDateTime(order.created_at)}`,
        `Cliente: ${order.user.name}`,
        '',
        'Servicios solicitados:',
        ...order.items.map((item) => `- ${item.quantity}x ${item.product_name}`),
        '',
        `Total venta cliente: ${money(order.sale_total || order.total)}`,
        `Valor a pagar proveedor: ${money(order.provider_total)}`,
        `Utilidad estimada: ${money(order.profit_total)}`,
        '',
        'Proveedor:',
        `Metodo: ${payout.destination_type || payout.method || 'No configurado'}`,
        `Numero destino: ${payout.destination_phone || 'No configurado'}`,
        '',
        'Instruccion:',
        'Realiza el pago al proveedor. Cuando recibas las cuentas, entra al panel admin, abre "Procesar cuentas entregadas", busca esta orden y pega el mensaje del proveedor.',
        '',
        'Orden para procesar:',
        order.order_number
    ].join('\n');
    return {
        subject: `Nuevo pedido pendiente de pago - ${order.order_number}`,
        text
    };
}
export async function sendAdminOrderNotificationEmail(order, payout, money, formatDateTime, overrideTo, smtpConfig) {
    const to = overrideTo || process.env.ADMIN_NOTIFICATION_EMAIL || '';
    if (!to)
        throw new Error('ADMIN_NOTIFICATION_EMAIL no configurado.');
    const email = buildAdminOrderEmail(order, payout, money, formatDateTime);
    await sendSmtpEmail({ to, ...email }, smtpConfig);
}
export { emailConfigured, sendSmtpEmail, verifySmtpConnection } from './smtpEmail.js';
