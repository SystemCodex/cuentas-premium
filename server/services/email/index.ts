import { sendSmtpEmail } from './smtpEmail.js';
import type { SmtpConfig } from './types.js';

export function buildAdminOrderEmail(order: any, payout: any, money: (value: number) => string, formatDateTime: (value: Date | string) => string) {
  const text = [
    'NUEVO PEDIDO PENDIENTE',
    '',
    `Orden: ${order.order_number}`,
    `Fecha: ${formatDateTime(order.created_at)}`,
    `Cliente: ${order.user.name}`,
    '',
    'Servicios solicitados:',
    ...order.items.map((item: any) => `- ${item.quantity}x ${item.product_name}`),
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

export async function sendAdminOrderNotificationEmail(order: any, payout: any, money: (value: number) => string, formatDateTime: (value: Date | string) => string, overrideTo?: string, smtpConfig?: SmtpConfig) {
  const to = overrideTo || process.env.ADMIN_NOTIFICATION_EMAIL || '';
  if (!to) throw new Error('ADMIN_NOTIFICATION_EMAIL no configurado.');
  const email = buildAdminOrderEmail(order, payout, money, formatDateTime);
  await sendSmtpEmail({ to, ...email }, smtpConfig);
}

export { emailConfigured, sendSmtpEmail, verifySmtpConnection } from './smtpEmail.js';
export type { SmtpConfig } from './types.js';
