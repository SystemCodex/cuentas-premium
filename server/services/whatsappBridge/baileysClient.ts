import type { PrismaClient } from '@prisma/client';
import makeWASocket, {
  Browsers,
  DisconnectReason,
  jidNormalizedUser,
  normalizeMessageContent
} from 'baileys';
import type { WASocket, WAMessage } from 'baileys';
import pino from 'pino';
import QRCode from 'qrcode';
import { createBaileysDatabaseAuthState } from './baileysAuthStore.js';
import type { WhatsAppBridgeConnection, WhatsAppInboundHandler } from './types.js';

let socket: WASocket | null = null;
let connection: WhatsAppBridgeConnection = 'disconnected';
let qrCodeDataUrl: string | null = null;
let lastError: string | null = null;
let initStarted = false;
let inboundHandler: WhatsAppInboundHandler | null = null;
let connectedNumber: string | null = null;
let nextInitializationAt = 0;
let socketGeneration = 0;
let activeAuth: Awaited<ReturnType<typeof createBaileysDatabaseAuthState>> | null = null;
let runtimeEnabled = (() => {
  const value = process.env.WHATSAPP_BRIDGE_ENABLED?.trim().toLowerCase();
  return value !== 'false' && value !== '0' && value !== 'off';
})();

const logger = pino({ level: process.env.WHATSAPP_BAILEYS_LOG_LEVEL || 'silent' });

function isEnabled() {
  return runtimeEnabled && process.env.WHATSAPP_BRIDGE_HARD_DISABLED?.trim().toLowerCase() !== 'true';
}

function retryDelayMs() {
  return Number(process.env.WHATSAPP_RECONNECT_DELAY_SECONDS || 10) * 1000;
}

function sanitizeError(error: unknown) {
  if (!(error instanceof Error)) return 'Error desconocido';
  return error.message.replace(/\+?\d{7,15}/g, '[redacted]').slice(0, 220);
}

function disconnectStatusCode(error: unknown) {
  const candidate = error as {
    output?: { statusCode?: number };
    data?: { statusCode?: number };
    statusCode?: number;
  } | undefined;
  return candidate?.output?.statusCode || candidate?.data?.statusCode || candidate?.statusCode;
}

function normalizeRecipientNumber(recipient: string) {
  const digits = recipient.replace(/[^\d]/g, '');
  if (!digits) throw new Error('Numero de WhatsApp invalido.');
  if (digits.length === 10 && digits.startsWith('3')) return `57${digits}`;
  return digits;
}

function normalizeOptionalNumber(recipient?: string | null) {
  const normalizedJid = jidNormalizedUser(recipient || '');
  const digits = normalizedJid.split('@')[0]?.split(':')[0]?.replace(/[^\d]/g, '') || '';
  return digits || null;
}

function extractMessageText(message: WAMessage) {
  const content = normalizeMessageContent(message.message);
  return (
    content?.conversation
    || content?.extendedTextMessage?.text
    || content?.imageMessage?.caption
    || content?.videoMessage?.caption
    || content?.documentMessage?.caption
    || content?.buttonsResponseMessage?.selectedDisplayText
    || content?.listResponseMessage?.title
    || ''
  ).trim();
}

function scheduleReconnect(statusCode?: number) {
  if (!isEnabled() || statusCode === DisconnectReason.loggedOut) return;
  nextInitializationAt =
    statusCode === DisconnectReason.restartRequired
      ? 0
      : Date.now() + retryDelayMs();
}

export function setWhatsAppInboundHandler(handler: WhatsAppInboundHandler | null) {
  inboundHandler = handler;
}

export function enableWhatsAppClient() {
  runtimeEnabled = true;
  nextInitializationAt = 0;
  if (connection === 'disabled') connection = 'disconnected';
}

export function disableWhatsAppClient() {
  runtimeEnabled = false;
  connection = 'disabled';
}

export async function initializeWhatsAppClient(prisma: PrismaClient) {
  if (!isEnabled()) {
    connection = 'disabled';
    return;
  }
  if (Date.now() < nextInitializationAt || initStarted || socket) return;

  initStarted = true;
  connection = 'connecting';
  lastError = null;
  const generation = ++socketGeneration;

  try {
    const auth = await createBaileysDatabaseAuthState(prisma);
    activeAuth = auth;
    const currentSocket = makeWASocket({
      auth: auth.state,
      logger,
      browser: Browsers.windows('Centro Digital'),
      markOnlineOnConnect: false,
      syncFullHistory: false,
      shouldSyncHistoryMessage: () => false,
      generateHighQualityLinkPreview: false,
      emitOwnEvents: false,
      qrTimeout: 60_000
    });
    socket = currentSocket;

    currentSocket.ev.on('creds.update', () => {
      void auth.saveCreds().catch((error: unknown) => {
        lastError = `No se pudo guardar la sesion: ${sanitizeError(error)}`;
      });
    });

    currentSocket.ev.on('connection.update', (update) => {
      if (generation !== socketGeneration) return;

      if (update.qr) {
        connection = 'connecting';
        lastError = null;
        void QRCode.toDataURL(update.qr, { width: 360, margin: 2 })
          .then((dataUrl) => {
            if (generation === socketGeneration) qrCodeDataUrl = dataUrl;
          })
          .catch((error: unknown) => {
            lastError = `No se pudo generar el QR: ${sanitizeError(error)}`;
          });
      }

      if (update.connection === 'open') {
        connection = 'connected';
        qrCodeDataUrl = null;
        connectedNumber = normalizeOptionalNumber(currentSocket.user?.id);
        nextInitializationAt = 0;
        lastError = null;
        initStarted = false;
        return;
      }

      if (update.connection === 'close') {
        const statusCode = disconnectStatusCode(update.lastDisconnect?.error);
        socket = null;
        initStarted = false;
        qrCodeDataUrl = null;
        connectedNumber = null;

        if (statusCode === DisconnectReason.loggedOut) {
          connection = 'disconnected';
          lastError = 'La sesion fue cerrada desde WhatsApp. Inicia una nueva vinculacion.';
          void auth.clear().catch(() => undefined);
          activeAuth = null;
          return;
        }

        connection = statusCode === DisconnectReason.restartRequired ? 'connecting' : 'disconnected';
        lastError =
          statusCode === DisconnectReason.restartRequired
            ? null
            : sanitizeError(update.lastDisconnect?.error);
        scheduleReconnect(statusCode);
      }
    });

    currentSocket.ev.on('messages.upsert', ({ messages, type }) => {
      if (!inboundHandler || process.env.WHATSAPP_INBOUND_ENABLED !== 'true' || type !== 'notify') return;
      for (const message of messages) {
        const body = extractMessageText(message);
        const from = message.key.remoteJid || '';
        if (!body || message.key.fromMe) continue;
        if (from.endsWith('@g.us') && process.env.WHATSAPP_PROCESS_GROUPS !== 'true') continue;
        void inboundHandler({
          whatsappMessageId: message.key.id || undefined,
          from,
          body,
          raw: {
            id: message.key.id,
            from,
            participant: message.key.participant,
            timestamp: message.messageTimestamp,
            pushName: message.pushName
          }
        }).catch(() => undefined);
      }
    });
  } catch (error) {
    socket = null;
    activeAuth = null;
    initStarted = false;
    connection = 'disconnected';
    connectedNumber = null;
    qrCodeDataUrl = null;
    lastError = sanitizeError(error);
    nextInitializationAt = Date.now() + retryDelayMs();
  }
}

export async function sendWhatsAppMessage(recipient: string, message: string) {
  if (!isEnabled()) throw new Error('WhatsApp Bridge desactivado.');
  if (connection !== 'connected' || !socket) throw new Error('WhatsApp no esta conectado.');

  const phone = normalizeRecipientNumber(recipient);
  const matches = await socket.onWhatsApp(phone);
  const destination = matches?.find((match) => match.exists)?.jid;
  if (!destination) throw new Error('El numero no existe en WhatsApp o debe incluir codigo de pais.');
  await socket.sendMessage(destination, { text: message });
}

export async function disconnectWhatsAppClient() {
  const currentSocket = socket;
  const auth = activeAuth;
  ++socketGeneration;
  socket = null;
  activeAuth = null;
  initStarted = false;
  qrCodeDataUrl = null;
  connectedNumber = null;
  nextInitializationAt = 0;

  await currentSocket?.logout().catch(() => undefined);
  await auth?.clear().catch(() => undefined);
  connection = isEnabled() ? 'disconnected' : 'disabled';
}

export function getWhatsAppRuntimeStatus() {
  return {
    enabled: isEnabled(),
    mode: 'baileys',
    connection,
    connectedNumber,
    qrPending: Boolean(qrCodeDataUrl),
    qr: qrCodeDataUrl,
    lastError
  };
}
