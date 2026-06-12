import path from 'node:path';
import fs from 'node:fs/promises';
import QRCode from 'qrcode';
let client = null;
let connection = 'disconnected';
let qrCodeDataUrl = null;
let lastError = null;
let initStarted = false;
let inboundHandler = null;
let connectedNumber = null;
let runtimeEnabled = (() => {
    const value = process.env.WHATSAPP_BRIDGE_ENABLED?.trim().toLowerCase();
    return value !== 'false' && value !== '0' && value !== 'off';
})();
function isEnabled() {
    return runtimeEnabled && process.env.WHATSAPP_BRIDGE_HARD_DISABLED?.trim().toLowerCase() !== 'true';
}
function sanitizeError(error) {
    return error instanceof Error ? error.message.slice(0, 220) : 'Error desconocido';
}
function normalizeRecipientNumber(recipient) {
    const digits = recipient.replace(/[^\d]/g, '');
    if (!digits)
        throw new Error('Numero de WhatsApp invalido.');
    if (digits.length === 10 && digits.startsWith('3'))
        return `57${digits}`;
    return digits;
}
function normalizeOptionalNumber(recipient) {
    const digits = String(recipient || '').replace(/[^\d]/g, '');
    if (!digits)
        return null;
    if (digits.length === 10 && digits.startsWith('3'))
        return `57${digits}`;
    return digits;
}
export function setWhatsAppInboundHandler(handler) {
    inboundHandler = handler;
}
export function enableWhatsAppWebClient() {
    runtimeEnabled = true;
    if (connection === 'disabled')
        connection = 'disconnected';
}
export function disableWhatsAppWebClient() {
    runtimeEnabled = false;
    connection = 'disabled';
}
export async function initializeWhatsAppWebClient() {
    if (!isEnabled()) {
        connection = 'disabled';
        return;
    }
    if (initStarted || client)
        return;
    initStarted = true;
    connection = 'connecting';
    try {
        process.env.PUPPETEER_CACHE_DIR ||= path.resolve('.cache', 'puppeteer');
        const puppeteerModule = await import('puppeteer');
        const puppeteer = puppeteerModule.default || puppeteerModule;
        const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH?.trim() || puppeteer.executablePath();
        await fs.chmod(executablePath, 0o755);
        const whatsapp = await import('whatsapp-web.js');
        const whatsappWeb = whatsapp.default || whatsapp;
        const { Client, LocalAuth } = whatsappWeb;
        const sessionPath = process.env.WHATSAPP_SESSION_PATH || './.whatsapp-session';
        client = new Client({
            authStrategy: new LocalAuth({ dataPath: path.resolve(sessionPath) }),
            puppeteer: {
                headless: true,
                executablePath,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-gpu',
                    '--no-zygote'
                ]
            }
        });
        client.on('qr', async (qr) => {
            qrCodeDataUrl = await QRCode.toDataURL(qr);
            connection = 'connecting';
            lastError = null;
        });
        client.on('ready', () => {
            qrCodeDataUrl = null;
            connection = 'connected';
            connectedNumber = normalizeOptionalNumber(client.info?.wid?.user || client.info?.wid?._serialized);
            lastError = null;
        });
        client.on('authenticated', () => {
            lastError = null;
        });
        client.on('auth_failure', (message) => {
            connection = 'disconnected';
            connectedNumber = null;
            lastError = message.slice(0, 220);
        });
        client.on('disconnected', (reason) => {
            connection = 'disconnected';
            connectedNumber = null;
            lastError = String(reason).slice(0, 220);
            client = null;
            initStarted = false;
        });
        client.on('message', async (message) => {
            if (!inboundHandler || process.env.WHATSAPP_INBOUND_ENABLED !== 'true')
                return;
            if (!message?.body?.trim())
                return;
            if (message.from?.includes('@g.us') && process.env.WHATSAPP_PROCESS_GROUPS !== 'true')
                return;
            await inboundHandler({
                whatsappMessageId: message.id?._serialized || message.id?.id,
                from: message.from || '',
                body: message.body,
                raw: {
                    id: message.id,
                    from: message.from,
                    to: message.to,
                    timestamp: message.timestamp,
                    type: message.type
                }
            });
        });
        await client.initialize();
    }
    catch (error) {
        connection = 'disconnected';
        connectedNumber = null;
        lastError = sanitizeError(error);
        client = null;
        initStarted = false;
    }
}
export async function sendWhatsAppWebMessage(recipient, message) {
    if (!isEnabled())
        throw new Error('WhatsApp Bridge desactivado.');
    if (connection !== 'connected' || !client)
        throw new Error('WhatsApp Web no esta conectado.');
    const phone = normalizeRecipientNumber(recipient);
    const numberId = await client.getNumberId(phone);
    if (!numberId?._serialized) {
        throw new Error('El numero no existe en WhatsApp o debe incluir codigo de pais.');
    }
    await client.sendMessage(numberId._serialized, message);
}
export async function disconnectWhatsAppWebClient() {
    try {
        if (client) {
            await client.logout().catch(() => null);
            await client.destroy().catch(() => null);
        }
    }
    finally {
        client = null;
        initStarted = false;
        qrCodeDataUrl = null;
        connectedNumber = null;
        connection = isEnabled() ? 'disconnected' : 'disabled';
    }
}
export function getWhatsAppWebRuntimeStatus() {
    return {
        enabled: isEnabled(),
        mode: process.env.WHATSAPP_BRIDGE_MODE || 'web',
        connection,
        connectedNumber,
        qrPending: Boolean(qrCodeDataUrl),
        qr: qrCodeDataUrl,
        lastError
    };
}
