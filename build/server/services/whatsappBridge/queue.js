import { getWhatsAppRuntimeStatus, sendWhatsAppMessage } from './baileysClient.js';
function maxAttempts() {
    return Number(process.env.WHATSAPP_MAX_ATTEMPTS || 3);
}
function retryDelayMs() {
    return Number(process.env.WHATSAPP_RETRY_DELAY_SECONDS || 30) * 1000;
}
function emailFallbackDelayMs() {
    return Number(process.env.WHATSAPP_EMAIL_FALLBACK_SECONDS || 60) * 1000;
}
function sanitizeError(error) {
    return error instanceof Error ? error.message.replace(/\+?\d{7,15}/g, '[redacted]').slice(0, 220) : 'Error desconocido';
}
export async function enqueueWhatsAppMessage(prisma, input) {
    if (input.payoutId) {
        const existing = await prisma.whatsAppOutbox.findUnique({ where: { payout_id: input.payoutId } });
        if (existing?.status === 'sent' || existing?.status === 'pending')
            return existing;
        if (existing) {
            return prisma.whatsAppOutbox.update({
                where: { id: existing.id },
                data: {
                    recipient: input.recipient,
                    message: input.message,
                    order_id: input.orderId,
                    status: 'pending',
                    attempts: 0,
                    last_error: null
                }
            });
        }
        return prisma.whatsAppOutbox.create({
            data: {
                recipient: input.recipient,
                message: input.message,
                order_id: input.orderId,
                payout_id: input.payoutId
            }
        });
    }
    return prisma.whatsAppOutbox.create({
        data: {
            recipient: input.recipient,
            message: input.message,
            order_id: input.orderId
        }
    });
}
export async function retryFailedWhatsAppMessages(prisma) {
    await prisma.whatsAppOutbox.updateMany({
        where: { status: 'failed' },
        data: { status: 'pending', attempts: 0, last_error: null }
    });
}
export async function getWhatsAppOutboxCounts(prisma) {
    const [pending, sent, failed, emailFallback] = await Promise.all([
        prisma.whatsAppOutbox.count({ where: { status: 'pending' } }),
        prisma.whatsAppOutbox.count({ where: { status: 'sent' } }),
        prisma.whatsAppOutbox.count({ where: { status: 'failed' } }),
        prisma.whatsAppOutbox.count({ where: { status: 'email_fallback' } })
    ]);
    return { pending, sent, failed, emailFallback };
}
export async function processWhatsAppOutbox(prisma, addMovement, onFinalFailure) {
    const runtime = getWhatsAppRuntimeStatus();
    const now = Date.now();
    const items = await prisma.whatsAppOutbox.findMany({
        where: { status: 'pending', attempts: { lt: maxAttempts() } },
        orderBy: { created_at: 'asc' },
        take: 5
    });
    for (const item of items) {
        const isOrderNotification = Boolean(item.order_id && item.payout_id);
        const fallbackExpired = now - item.created_at.getTime() >= emailFallbackDelayMs();
        const fallbackRetryReady = item.attempts === 0
            || now - item.updated_at.getTime() >= retryDelayMs();
        if (isOrderNotification && fallbackExpired && fallbackRetryReady && onFinalFailure) {
            const fallbackResult = await onFinalFailure({
                id: item.id,
                recipient: item.recipient,
                message: item.message,
                order_id: item.order_id,
                payout_id: item.payout_id
            });
            if (fallbackResult === 'email' || fallbackResult === 'whatsapp') {
                await prisma.whatsAppOutbox.update({
                    where: { id: item.id },
                    data: {
                        status: fallbackResult === 'email' ? 'email_fallback' : 'sent',
                        sent_at: fallbackResult === 'whatsapp' ? new Date() : null,
                        last_error: fallbackResult === 'email'
                            ? 'WhatsApp no se confirmo dentro del tiempo limite; respaldo enviado por correo.'
                            : null
                    }
                });
                if (fallbackResult === 'email') {
                    await addMovement('whatsapp.email_fallback', `Aviso WhatsApp para pedido ${item.order_id} reemplazado por correo de respaldo.`, undefined, item.order_id || undefined);
                }
                continue;
            }
            if (fallbackResult === 'failed') {
                const attempts = item.attempts + 1;
                await prisma.whatsAppOutbox.update({
                    where: { id: item.id },
                    data: {
                        attempts,
                        status: attempts >= maxAttempts() ? 'failed' : 'pending',
                        last_error: 'No fue posible enviar WhatsApp ni el correo de respaldo.'
                    }
                });
                if (!runtime.enabled || runtime.connection !== 'connected')
                    continue;
            }
        }
        if (!runtime.enabled || runtime.connection !== 'connected')
            continue;
        if (item.attempts > 0 && now - item.updated_at.getTime() < retryDelayMs())
            continue;
        try {
            await sendWhatsAppMessage(item.recipient, item.message);
            await prisma.whatsAppOutbox.update({
                where: { id: item.id },
                data: { status: 'sent', sent_at: new Date(), last_error: null }
            });
            if (item.order_id) {
                await prisma.order.update({
                    where: { id: item.order_id },
                    data: { admin_notified_at: new Date(), admin_notification_channel: 'whatsapp', whatsapp_sent: true }
                }).catch(() => null);
            }
            await addMovement('whatsapp.sent', `WhatsApp Bridge envio comprobante para pedido ${item.order_id || '-'}.`, undefined, item.order_id || undefined);
            if (item.order_id) {
                await addMovement('provider_payout.receipt_sent', `Comprobante enviado por WhatsApp Bridge para pedido ${item.order_id}.`, undefined, item.order_id);
            }
        }
        catch (error) {
            const attempts = item.attempts + 1;
            let finalStatus = attempts >= maxAttempts() ? 'failed' : 'pending';
            let fallbackResult = null;
            if (finalStatus === 'failed' && item.order_id && onFinalFailure) {
                fallbackResult = await onFinalFailure({
                    id: item.id,
                    recipient: item.recipient,
                    message: item.message,
                    order_id: item.order_id,
                    payout_id: item.payout_id
                });
                if (fallbackResult === 'email')
                    finalStatus = 'email_fallback';
                if (fallbackResult === 'whatsapp')
                    finalStatus = 'sent';
            }
            await prisma.whatsAppOutbox.update({
                where: { id: item.id },
                data: {
                    attempts,
                    status: finalStatus,
                    sent_at: fallbackResult === 'whatsapp' ? new Date() : null,
                    last_error: fallbackResult === 'email'
                        ? 'WhatsApp fallo; respaldo enviado por correo.'
                        : sanitizeError(error)
                }
            });
            await addMovement('whatsapp.failed', `WhatsApp Bridge no pudo enviar comprobante para pedido ${item.order_id || '-'}.`, undefined, item.order_id || undefined);
            if (finalStatus === 'failed' && item.order_id) {
                await addMovement('provider_payout.receipt_failed', `Comprobante WhatsApp agoto intentos para pedido ${item.order_id}.`, undefined, item.order_id);
            }
            if (finalStatus === 'email_fallback' && item.order_id) {
                await addMovement('whatsapp.email_fallback', `WhatsApp fallo para pedido ${item.order_id}; correo de respaldo enviado.`, undefined, item.order_id);
            }
        }
    }
}
