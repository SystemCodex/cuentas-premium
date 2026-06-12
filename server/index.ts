import 'dotenv/config';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { NextFunction, Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import {
  disconnectWhatsAppBridge,
  enableWhatsAppBridge,
  getWhatsAppBridgeQr,
  getWhatsAppBridgeStatus,
  queueWhatsAppNotification,
  retryFailedWhatsAppOutbox,
  startWhatsAppBridgeWorker
} from './services/whatsappBridge/index.js';
import { parseAccountMessage, serviceKeyFromText } from './services/inboundDeliveryParser/index.js';
import type { ParsedAccountMessage, ParsedDeliveryAccount } from './services/inboundDeliveryParser/index.js';
import type { WhatsAppInboundPayload, WhatsAppOutboxFallbackResult } from './services/whatsappBridge/types.js';
import { parseDeliveryMessage } from './services/deliveryParser/index.js';
import type { DeliveryParserItem } from './services/deliveryParser/index.js';
import { emailConfigured, sendAdminOrderNotificationEmail, sendSmtpEmail, verifySmtpConnection } from './services/email/index.js';
import type { SmtpConfig } from './services/email/index.js';

function configureRuntimeDatabaseUrl() {
  const raw = process.env.DATABASE_URL;
  const usePooler = process.env.DATABASE_USE_POOLER?.trim().toLowerCase() !== 'false';
  if (!raw || process.env.NODE_ENV !== 'production' || !usePooler) return;

  try {
    const databaseUrl = new URL(raw);
    const [endpoint, ...domainParts] = databaseUrl.hostname.split('.');
    if (databaseUrl.hostname.endsWith('.neon.tech') && endpoint && !endpoint.endsWith('-pooler')) {
      databaseUrl.hostname = [`${endpoint}-pooler`, ...domainParts].join('.');
      process.env.DATABASE_URL = databaseUrl.toString();
    }
  } catch {
    // Prisma will report a sanitized connection error through the health check.
  }
}

configureRuntimeDatabaseUrl();

const prisma = new PrismaClient();
const app = express();
const port = Number(process.env.PORT || 3000);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDistPath = path.resolve(process.cwd(), 'dist');
const jwtSecret = process.env.JWT_SECRET;
const allowedOrigins = (process.env.CORS_ORIGIN || process.env.FRONTEND_ORIGIN || 'http://localhost:5174')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

function assertProductionEnv() {
  if (!jwtSecret) throw new Error('JWT_SECRET es requerido.');
  if (process.env.NODE_ENV !== 'production') return;
  const required = ['DATABASE_URL', 'JWT_SECRET', 'APP_ENCRYPTION_KEY', 'CORS_ORIGIN'];
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length) throw new Error(`Variables requeridas faltantes: ${missing.join(', ')}`);
  if ((process.env.JWT_SECRET || '').length < 32) throw new Error('JWT_SECRET debe tener al menos 32 caracteres.');
  if ((process.env.APP_ENCRYPTION_KEY || '').length < 32) throw new Error('APP_ENCRYPTION_KEY debe tener al menos 32 caracteres y ser estable.');
}

assertProductionEnv();

app.set('trust proxy', 1);
app.use(helmet());
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('Origen no permitido por CORS.'));
  },
  credentials: true
}));
app.use(express.json({
  limit: '1mb',
  verify: (req, _res, buf) => {
    (req as Request).rawBody = buf.toString('utf8');
  }
}));

const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 400,
  standardHeaders: true,
  legacyHeaders: false
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Demasiados intentos. Intenta de nuevo mas tarde.' }
});

const sensitiveLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false
});

app.use('/api', generalLimiter);

type Role = 'client' | 'provider' | 'admin';
type OrderStatus = 'admin_payment_pending' | 'provider_delivery_pending' | 'wallet_pending' | 'payout_processing' | 'pending_payment' | 'paid' | 'pending' | 'processing' | 'delivered' | 'payout_failed' | 'payment_failed' | 'cancelled';
type AuthUser = { id: string; role: Role; email: string; name: string };
const orderStatusValues = ['admin_payment_pending', 'provider_delivery_pending', 'wallet_pending', 'payout_processing', 'pending_payment', 'paid', 'pending', 'processing', 'delivered', 'payout_failed', 'payment_failed', 'cancelled'] as const;

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
      rawBody?: string;
    }
  }
}

const money = (value: number) => `$${new Intl.NumberFormat('es-CO').format(value)}`;
const billingPeriod = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
const formatDateTimeCO = (value: Date | string) =>
  new Intl.DateTimeFormat('es-CO', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'America/Bogota'
  }).format(new Date(value));

function signToken(user: AuthUser) {
  return jwt.sign(user, jwtSecret!, { expiresIn: '7d' });
}

function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ message: 'Autenticacion requerida.' });
  try {
    req.user = jwt.verify(token, jwtSecret!) as AuthUser;
    next();
  } catch {
    return res.status(401).json({ message: 'Sesion invalida o expirada.' });
  }
}

function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ message: 'No tienes permiso para esta accion.' });
    }
    next();
  };
}

function paramId(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value || '';
}

function keyBytes() {
  if (!process.env.APP_ENCRYPTION_KEY) throw new Error('APP_ENCRYPTION_KEY es requerido.');
  return crypto.createHash('sha256').update(process.env.APP_ENCRYPTION_KEY).digest();
}

function encryptSecret(value?: string | null) {
  if (!value) return value || null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyBytes(), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}.${tag.toString('base64')}.${encrypted.toString('base64')}`;
}

function decryptSecret(value?: string | null) {
  if (!value) return value || null;
  const [ivRaw, tagRaw, dataRaw] = value.split('.');
  if (!ivRaw || !tagRaw || !dataRaw) return value;
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', keyBytes(), Buffer.from(ivRaw, 'base64'));
    decipher.setAuthTag(Buffer.from(tagRaw, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(dataRaw, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    return '***';
  }
}

function publicUser(user: { id: string; name: string; email: string; role: Role; phone: string | null; created_at: Date }) {
  return { id: user.id, name: user.name, email: user.email, role: user.role, phone: user.phone, created_at: user.created_at };
}

function safeUser(user?: any, includePhone = true) {
  if (!user) return user || null;
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    phone: includePhone ? user.phone : null,
    created_at: user.created_at
  };
}

function serializeOrder(order: any, viewer?: AuthUser) {
  const canSeeSecrets =
    viewer?.role === 'admin' ||
    (viewer?.role === 'provider' && (!order.provider_id || order.provider_id === viewer.id)) ||
    viewer?.id === order.user_id;

  const isProviderViewer = viewer?.role === 'provider';
  const isAdminViewer = viewer?.role === 'admin';
  const isClientOwner = viewer?.id === order.user_id;
  const serializedDeliveries = (order.deliveries || []).map((delivery: any) => ({
    ...delivery,
    product: delivery.product ? serializeProduct(delivery.product, viewer) : delivery.product,
    delivered_by: viewer?.role === 'admin' || viewer?.role === 'provider' ? delivery.delivered_by : undefined,
    delivered_password: canSeeSecrets ? decryptSecret(delivery.delivered_password) : undefined
  }));
  const serializedItems = (order.items || []).map((item: any) => ({
    ...item,
    product: item.product ? serializeProduct(item.product, viewer) : item.product,
    unit_price: isProviderViewer && !isAdminViewer ? (item.product?.provider_cost || Math.round((order.provider_total || order.total) / Math.max(1, (order.items || []).reduce((sum: number, orderItem: any) => sum + orderItem.quantity, 0)))) : item.unit_price,
    subtotal: isProviderViewer && !isAdminViewer ? (item.product?.provider_cost || Math.round((order.provider_total || order.total) / Math.max(1, (order.items || []).reduce((sum: number, orderItem: any) => sum + orderItem.quantity, 0)))) * item.quantity : item.subtotal,
    delivered_accounts: serializedDeliveries.filter((delivery: any) => delivery.order_item_id === item.id)
  }));

  return {
    ...order,
    total: isProviderViewer && !isAdminViewer ? order.provider_total || order.total : order.total,
    sale_total: isAdminViewer || isClientOwner ? order.sale_total : undefined,
    provider_total: isAdminViewer || isProviderViewer ? order.provider_total : undefined,
    profit_total: isAdminViewer ? order.profit_total : undefined,
    provider_id: viewer?.role === 'admin' || viewer?.role === 'provider' ? order.provider_id : null,
    items: serializedItems,
    user: viewer?.role === 'provider' || viewer?.role === 'admin' || viewer?.id === order.user_id ? safeUser(order.user, true) : undefined,
    provider: viewer?.role === 'admin' || viewer?.role === 'provider' ? safeUser(order.provider, true) : null,
    payments: (order.payments || []).map((payment: any) => ({
      id: payment.id,
      order_id: payment.order_id,
      provider: payment.provider,
      method: payment.method,
      status: payment.status,
      amount: payment.amount,
      currency: payment.currency,
      transaction_id: payment.transaction_id,
      reference: payment.reference,
      confirmed_at: payment.confirmed_at,
      created_at: payment.created_at,
      updated_at: payment.updated_at
    })),
    providerPayouts:
      viewer?.role === 'admin' || viewer?.role === 'provider'
        ? (order.providerPayouts || []).map((payout: any) => ({
            id: payout.id,
            order_id: payout.order_id,
            provider_id: viewer?.role === 'admin' ? payout.provider_id : undefined,
            amount: payout.amount,
            currency: payout.currency,
            method: payout.method,
            status: payout.status,
            transaction_id: viewer?.role === 'admin' ? payout.transaction_id : undefined,
            reference: viewer?.role === 'admin' ? payout.reference : undefined,
            destination_type: viewer?.role === 'admin' ? payout.destination_type : undefined,
            confirmed_at: payout.confirmed_at,
            created_at: payout.created_at
          }))
        : undefined,
    deliveries: serializedDeliveries
  };
}

function serializeProduct(product: any, viewer?: AuthUser) {
  if (viewer?.role === 'admin') return product;
  if (viewer?.role === 'provider') {
    const { price, ...providerProduct } = product;
    return providerProduct;
  }
  const { provider_cost, ...publicProduct } = product;
  return publicProduct;
}

async function addMovement(type: string, description: string, user_id?: string, order_id?: string) {
  await prisma.movement.create({ data: { type, description, user_id, order_id } });
}

async function generateOrderNumber() {
  const year = new Date().getFullYear();
  const prefix = `ORD-${year}-`;
  const latest = await prisma.order.findFirst({
    where: { order_number: { startsWith: prefix } },
    orderBy: { order_number: 'desc' }
  });
  const latestSeq = latest?.order_number ? Number(latest.order_number.split('-').at(-1) || 0) : 0;
  for (let offset = 1; offset < 25; offset += 1) {
    const candidate = `${prefix}${String(latestSeq + offset).padStart(6, '0')}`;
    const exists = await prisma.order.findUnique({ where: { order_number: candidate } });
    if (!exists) return candidate;
  }
  return `${prefix}${String(Date.now()).slice(-6)}`;
}

async function createNotification(user_id: string, order_id: string | null, type: string, title: string, message: string) {
  return prisma.notification.create({
    data: { user_id, order_id, type, title, message }
  });
}

function normalizePhone(value: string) {
  return value.replace(/[^\d]/g, '');
}

function normalizeWhatsAppPhoneForCompare(value?: string | null) {
  const digits = String(value || '').replace(/[^\d]/g, '');
  if (digits.length === 10 && digits.startsWith('3')) return `57${digits}`;
  return digits;
}

function allowedInboundNumbers() {
  return (process.env.WHATSAPP_ALLOWED_INBOUND_NUMBERS || process.env.WHATSAPP_ADMIN_PHONE || '')
    .split(',')
    .map((item) => normalizePhone(item))
    .filter(Boolean);
}

function isInboundAllowed(from: string) {
  const allowed = allowedInboundNumbers();
  if (!allowed.length) return true;
  const source = normalizePhone(from);
  return allowed.some((number) => source.endsWith(number) || number.endsWith(source));
}

function autoDeliveryThreshold() {
  return Number(process.env.AUTO_DELIVERY_CONFIDENCE_THRESHOLD || 85);
}

function accountHasMinimumData(account: ParsedDeliveryAccount) {
  return Boolean((account.delivered_email || account.delivered_user) && account.delivered_password);
}

function extractOrderNumberFromText(text: string) {
  return text.match(/(?:orden|pedido|order)\s*[:#-]?\s*(ORD-\d{4}-\d{6}|CDD-\d{4}-\d{6})/i)?.[1]?.toUpperCase();
}

function matchAccountToItem(account: ParsedDeliveryAccount, items: any[], usedItemIds = new Set<string>()) {
  const accountKey = serviceKeyFromText(account.service);
  return items.find((item) => {
    if (usedItemIds.has(item.id)) return false;
    const productKey = serviceKeyFromText(`${item.product_name} ${item.product?.brand_key || ''}`);
    return accountKey && productKey && accountKey === productKey;
  }) || items.find((item) => !usedItemIds.has(item.id));
}

async function findOrderForParsedMessage(parsed: ParsedAccountMessage) {
  const pendingWhere = { status: { notIn: ['delivered', 'cancelled', 'payment_failed', 'payout_failed'] as any } };
  if (parsed.orderHint) {
    const order = await prisma.order.findFirst({
      where: {
        ...pendingWhere,
        OR: [{ id: parsed.orderHint }, { id: { startsWith: parsed.orderHint } }, { order_number: parsed.orderHint.toUpperCase() }]
      },
      include: { user: true, provider: true, items: { include: { product: true } }, deliveries: true, payments: true, providerPayouts: true }
    });
    if (order) return { order, ambiguous: false };
  }

  const serviceKeys = parsed.accounts.map((account: ParsedDeliveryAccount) => serviceKeyFromText(account.service)).filter(Boolean);
  if (!serviceKeys.length) return { order: null, ambiguous: false };

  const candidates = await prisma.order.findMany({
    where: pendingWhere,
    include: { user: true, provider: true, items: { include: { product: true } }, deliveries: true, payments: true, providerPayouts: true },
    orderBy: { created_at: 'desc' },
    take: 20
  });
  const matches = candidates.filter((order) => {
    const orderKeys = order.items.map((item) => serviceKeyFromText(`${item.product_name} ${item.product?.brand_key || ''}`)).filter(Boolean);
    return serviceKeys.every((key: string) => orderKeys.includes(key));
  });
  return { order: matches.length === 1 ? matches[0] : null, ambiguous: matches.length > 1 };
}

async function deliveryActorForOrder(order: any) {
  if (order.provider_id) return order.provider_id;
  const provider = await prisma.user.findFirst({ where: { role: 'provider' }, orderBy: { created_at: 'asc' } });
  if (provider) return provider.id;
  const admin = await prisma.user.findFirst({ where: { role: 'admin' }, orderBy: { created_at: 'asc' } });
  if (!admin) throw new Error('No hay usuario proveedor o admin para registrar la entrega.');
  return admin.id;
}

async function refreshOrderDeliveryStatus(orderId: string, actorId: string) {
  const order = await prisma.order.findUniqueOrThrow({
    where: { id: orderId },
    include: { user: true, provider: true, items: { include: { product: true } }, deliveries: { include: { product: true } }, payments: true, providerPayouts: true }
  });
  const deliveryCounts = await prisma.deliveredAccount.groupBy({
    by: ['order_item_id'],
    where: { order_id: order.id },
    _count: { id: true }
  });
  const countByItem = new Map(deliveryCounts.map((entry) => [entry.order_item_id, entry._count.id]));
  const allItemsDelivered = order.items.every((item) => (countByItem.get(item.id) || 0) >= item.quantity);
  return prisma.order.update({
    where: { id: order.id },
    data: {
      status: allItemsDelivered ? 'delivered' : 'processing',
      provider_id: order.provider_id || actorId,
      delivery_processed_at: new Date(),
      delivered_at: allItemsDelivered ? new Date() : order.delivered_at
    },
    include: { user: true, provider: true, items: { include: { product: true } }, deliveries: { include: { product: true } }, payments: true, providerPayouts: true }
  });
}

async function createDeliveriesFromParsed(order: any, parsed: ParsedAccountMessage, actorId: string) {
  const usedItemIds = new Set<string>();
  let created = 0;

  for (const account of parsed.accounts) {
    if (!accountHasMinimumData(account)) continue;
    const item = matchAccountToItem(account, order.items, usedItemIds);
    if (!item) continue;
    const deliveredCount = await prisma.deliveredAccount.count({ where: { order_id: order.id, order_item_id: item.id } });
    if (deliveredCount >= item.quantity) {
      usedItemIds.add(item.id);
      continue;
    }
    await prisma.deliveredAccount.create({
      data: {
        order_id: order.id,
        order_item_id: item.id,
        product_id: item.product_id,
        delivered_email: account.delivered_email || account.delivered_user || null,
        delivered_password: encryptSecret(account.delivered_password),
        profile_name: account.profile_name || null,
        pin: account.pin || null,
        notes: [account.notes, account.iptv_url ? `URL IPTV: ${account.iptv_url}` : undefined].filter(Boolean).join(' | ') || null,
        delivered_by: actorId
      }
    });
    created += 1;
    usedItemIds.add(item.id);
  }

  const updated = await refreshOrderDeliveryStatus(order.id, actorId);
  if (created > 0) {
    await createNotification(
      order.user_id,
      order.id,
      'account.delivered',
      'Tu cuenta ya esta disponible',
      `Tu cuenta ya esta disponible. Orden ${order.order_number}.`
    );
    await prisma.order.update({ where: { id: order.id }, data: { client_notified_at: new Date() } });
    await addMovement('client.notification_created', `Cliente notificado por cuenta disponible en orden ${order.order_number}.`, order.user_id, order.id);
  }
  return { updated, created };
}

async function createDeliveriesFromAdminItems(order: any, items: DeliveryParserItem[], actorId: string) {
  let created = 0;
  const orderItemById = new Map((order.items || []).map((item: any) => [item.id, item]));

  for (const item of items) {
    if (!item.matchedOrderItemId || !item.matchedProductId) throw new Error('Cada cuenta debe tener producto y item de pedido relacionado.');
    const orderItem: any = orderItemById.get(item.matchedOrderItemId);
    if (!orderItem || orderItem.product_id !== item.matchedProductId) throw new Error('El producto no pertenece al pedido seleccionado.');
    if (!((item.delivered_email || item.delivered_user) && item.delivered_password)) throw new Error(`Faltan usuario/correo o contrasena para ${item.serviceName}.`);
    const deliveredCount = await prisma.deliveredAccount.count({ where: { order_id: order.id, order_item_id: orderItem.id } });
    if (deliveredCount >= orderItem.quantity) continue;
    const duplicate = await prisma.deliveredAccount.findFirst({
      where: {
        order_id: order.id,
        order_item_id: orderItem.id,
        delivered_email: item.delivered_email || item.delivered_user || null
      }
    });
    if (duplicate) continue;
    await prisma.deliveredAccount.create({
      data: {
        order_id: order.id,
        order_item_id: orderItem.id,
        product_id: orderItem.product_id,
        delivered_email: item.delivered_email || item.delivered_user || null,
        delivered_password: encryptSecret(item.delivered_password),
        profile_name: item.profile_name || null,
        pin: item.pin || null,
        notes: [item.notes, item.iptv_url ? `URL IPTV: ${item.iptv_url}` : undefined].filter(Boolean).join(' | ') || null,
        delivered_by: actorId
      }
    });
    created += 1;
    await addMovement('account.delivered', `Cuenta cargada para ${orderItem.product_name} en orden ${order.order_number}.`, actorId, order.id);
  }

  const updated = await refreshOrderDeliveryStatus(order.id, actorId);
  if (created > 0) {
    await createNotification(
      order.user_id,
      order.id,
      'account.delivered',
      'Tu cuenta ya esta disponible',
      `Tu cuenta ya esta disponible. Orden ${order.order_number}.`
    );
    await prisma.order.update({ where: { id: order.id }, data: { client_notified_at: new Date() } });
    await addMovement('client.notification_created', `Cliente notificado por cuenta disponible en orden ${order.order_number}.`, order.user_id, order.id);
  }
  return { updated, created };
}

async function notifyAdminInboundResult(message: string, orderId?: string) {
  const adminNumber = (await getAdminNotificationPhone()) || process.env.WHATSAPP_ADMIN_PHONE || '';
  if (!adminNumber) return;
  await queueWhatsAppNotification(prisma, { recipient: adminNumber, message, orderId });
  await addMovement('whatsapp.outbox_created', `Aviso admin encolado: ${message.slice(0, 80)}`, undefined, orderId);
}

async function createDeliveryDraft(inboundId: string, parsed: ParsedAccountMessage, orderId: string | null, status = 'needs_review') {
  const draft = await prisma.deliveryDraft.create({
    data: {
      inbound_message_id: inboundId,
      order_id: orderId,
      status,
      confidence: parsed.confidence,
      raw_text: parsed.normalizedText,
      parsed_data: parsed as any
    }
  });
  await addMovement('delivery.draft_created', `Borrador de entrega creado con confianza ${parsed.confidence}.`, undefined, orderId || undefined);
  await notifyAdminInboundResult('Mensaje recibido, pero requiere revision en Borradores de entrega.', orderId || undefined);
  return draft;
}

async function processInboundDeliveryMessage(payload: WhatsAppInboundPayload) {
  if (process.env.WHATSAPP_INBOUND_ENABLED !== 'true') return;
  if (!payload.body.trim()) return;

  const existing = payload.whatsappMessageId
    ? await prisma.whatsAppInboundMessage.findUnique({ where: { whatsapp_message_id: payload.whatsappMessageId } })
    : null;
  if (existing) return;

  const inbound = await prisma.whatsAppInboundMessage.create({
    data: {
      whatsapp_message_id: payload.whatsappMessageId || null,
      from: payload.from,
      body: payload.body,
      raw_payload: (payload.raw || {}) as any,
      status: isInboundAllowed(payload.from) ? 'received' : 'ignored'
    }
  });
  await addMovement('whatsapp.inbound_received', `Mensaje entrante de WhatsApp recibido desde ${normalizePhone(payload.from).slice(-4) || 'origen privado'}.`);

  if (!isInboundAllowed(payload.from)) return;

  try {
    const parsed = parseAccountMessage(payload.body);
    const { order, ambiguous } = await findOrderForParsedMessage(parsed);
    const complete = parsed.accounts.length > 0 && parsed.accounts.every(accountHasMinimumData);
    const canAutoDeliver = Boolean(order && !ambiguous && complete && parsed.confidence >= autoDeliveryThreshold());

    if (!order || ambiguous || !canAutoDeliver) {
      await createDeliveryDraft(inbound.id, parsed, order?.id || null);
      await prisma.whatsAppInboundMessage.update({ where: { id: inbound.id }, data: { status: 'draft_created' } });
      return;
    }

    const actorId = await deliveryActorForOrder(order);
    const { created } = await createDeliveriesFromParsed(order, parsed, actorId);
    if (!created) {
      await createDeliveryDraft(inbound.id, parsed, order.id);
      await prisma.whatsAppInboundMessage.update({ where: { id: inbound.id }, data: { status: 'draft_created' } });
      return;
    }
    await addMovement('delivery.auto_parsed', `Mensaje de WhatsApp interpretado con confianza ${parsed.confidence}.`, actorId, order.id);
    await addMovement('delivery.auto_delivered', `${created} cuenta(s) agregadas automaticamente a la orden ${order.order_number}.`, actorId, order.id);
    await prisma.whatsAppInboundMessage.update({ where: { id: inbound.id }, data: { status: 'auto_delivered' } });
    await notifyAdminInboundResult(`Cuentas agregadas automaticamente a la orden ${order.order_number}.`, order.id);
  } catch (error) {
    await prisma.whatsAppInboundMessage.update({
      where: { id: inbound.id },
      data: { status: 'failed' }
    });
    await addMovement('delivery.inbound_failed', `No se pudo procesar mensaje entrante: ${error instanceof Error ? error.message.slice(0, 120) : 'error desconocido'}.`);
  }
}

function buildAdminPaymentPendingMessage(order: any, payout: any) {
  const lines = [
    'NUEVO PEDIDO PENDIENTE',
    '',
    `Orden: ${order.order_number}`,
    `Cliente: ${order.user.name}`,
    `Fecha: ${formatDateTimeCO(order.created_at)}`,
    '',
    'Servicios solicitados:',
    ...order.items.map((item: any) => `- ${item.quantity}x ${item.product_name}`),
    '',
    `Total venta cliente: ${money(order.sale_total || order.total)}`,
    `Valor a pagar proveedor: ${money(order.provider_total)}`,
    `Utilidad estimada: ${money(order.profit_total)}`,
    '',
    'Cuando recibas las cuentas del proveedor:',
    '1. Entra a Admin > Procesar cuentas entregadas.',
    `2. Selecciona la orden ${order.order_number}.`,
    '3. Pega el mensaje del proveedor.',
    '4. Aprueba la entrega.'
  ];
  return lines.join('\n');
}

async function getSettingMap() {
  const settings = await prisma.appSetting.findMany({
    where: {
      key: {
        notIn: ['whatsapp_baileys_creds_v1', 'whatsapp_baileys_keys_v1']
      }
    }
  });
  return new Map(settings.map((setting) => [setting.key, setting.value]));
}

async function upsertSetting(key: string, value: string, isPrivate = true) {
  return prisma.appSetting.upsert({
    where: { key },
    update: { value, private: isPrivate },
    create: { key, value, private: isPrivate }
  });
}

async function getSettingValue(key: string, fallback = '') {
  const setting = await prisma.appSetting.findUnique({ where: { key } });
  return setting?.value || fallback;
}

async function getAdminNotificationPhone() {
  return getSettingValue('admin_notification_phone', process.env.ADMIN_NOTIFICATION_PHONE || '');
}

async function getAdminNotificationEmail() {
  return getSettingValue('admin_notification_email', process.env.ADMIN_NOTIFICATION_EMAIL || '');
}

function settingBoolean(value: string | undefined, fallback: boolean) {
  if (value === undefined || value === '') return fallback;
  return value.trim().toLowerCase() === 'true';
}

async function getSmtpConfig(): Promise<SmtpConfig & { source: 'database' | 'environment'; passwordConfigured: boolean }> {
  const settings = await getSettingMap();
  const databaseConfigured = Boolean(settings.get('smtp_host') || settings.get('smtp_from') || settings.get('smtp_user'));
  const port = Number(settings.get('smtp_port') || process.env.SMTP_PORT || 587);
  const encryptedPassword = settings.get('smtp_pass_encrypted');
  const savedPassword = encryptedPassword ? decryptSecret(encryptedPassword) : '';
  const password = savedPassword && savedPassword !== '***' ? savedPassword : process.env.SMTP_PASS || '';

  return {
    host: settings.get('smtp_host') || process.env.SMTP_HOST || '',
    port,
    secure: settingBoolean(settings.get('smtp_secure') || process.env.SMTP_SECURE, port === 465),
    user: settings.get('smtp_user') || process.env.SMTP_USER || '',
    pass: password,
    from: settings.get('smtp_from') || process.env.SMTP_FROM || process.env.SMTP_USER || '',
    source: databaseConfigured ? 'database' : 'environment',
    passwordConfigured: Boolean(password)
  };
}

async function getEmailStatus() {
  const config = await getSmtpConfig();
  return {
    configured: emailConfigured(config),
    source: config.source,
    host: config.host,
    port: config.port,
    secure: config.secure,
    user: config.user || '',
    from: config.from,
    passwordConfigured: config.passwordConfigured,
    recipient: await getAdminNotificationEmail(),
    lastTestStatus: await getSettingValue('smtp_last_test_status'),
    lastTestAt: await getSettingValue('smtp_last_test_at'),
    lastError: await getSettingValue('smtp_last_test_error')
  };
}

function isServimilUser(user: { name?: string | null; email?: string | null }) {
  return user.name?.toLowerCase().includes('servimil') || user.email === 'cliente@centrodigital.local';
}

function isPendingDeliveryStatus(status: string) {
  return !['delivered', 'cancelled', 'payment_failed', 'payout_failed'].includes(status);
}

function normalizeOrderNumberInput(value?: string | null) {
  return value?.trim().toUpperCase() || undefined;
}

async function getProviderPaymentConfig(providerId?: string | null) {
  return prisma.providerPaymentConfig.findFirst({
    where: {
      active: true,
      OR: [{ provider_id: providerId || undefined }, { provider_id: null }]
    },
    orderBy: [{ provider_id: 'desc' }, { updated_at: 'desc' }]
  });
}

async function getAnyProviderPaymentConfig(providerId?: string | null) {
  return prisma.providerPaymentConfig.findFirst({
    where: { OR: [{ provider_id: providerId || undefined }, { provider_id: null }] },
    orderBy: [{ provider_id: 'desc' }, { updated_at: 'desc' }]
  });
}

async function notifyAdminPaymentPending(order: any, payout: any) {
  const adminNumber = await getAdminNotificationPhone();
  const bridgeStatus = await getWhatsAppBridgeStatus(prisma);
  const message = buildAdminPaymentPendingMessage(order, payout);

  if (adminNumber && bridgeStatus.enabled) {
    const outbox = await queueWhatsAppNotification(prisma, {
      recipient: adminNumber,
      message,
      orderId: order.id,
      payoutId: payout.id
    });
    await prisma.order.update({ where: { id: order.id }, data: { admin_notification_channel: 'pending' } });
    await addMovement('whatsapp.outbox_created', `Aviso administrativo de orden ${order.order_number} agregado a WhatsApp Bridge.`, order.user_id, order.id);
    await addMovement('admin.payment_notification_whatsapp_pending', `WhatsApp pendiente para orden ${order.order_number}; estado bridge: ${bridgeStatus.connection}.`, order.user_id, order.id);
    if (bridgeStatus.connection !== 'connected') {
      await addMovement('admin.payment_notification_email_fallback_requested', `WhatsApp Bridge no esta conectado para orden ${order.order_number}; se envia respaldo por correo.`, order.user_id, order.id);
      const emailResult = await notifyAdminPaymentByEmail(order, payout, 'email_bridge_not_connected_fallback');
      if (emailResult !== 'email_failed') {
        await prisma.whatsAppOutbox.update({
          where: { id: outbox.id },
          data: {
            status: 'email_fallback',
            last_error: 'WhatsApp no estaba conectado; respaldo enviado por correo.'
          }
        });
      }
      return 'whatsapp_pending_email_fallback';
    }
    if (normalizeWhatsAppPhoneForCompare(adminNumber) === normalizeWhatsAppPhoneForCompare(bridgeStatus.connectedNumber)) {
      await addMovement('admin.payment_notification_self_chat', `Orden ${order.order_number}: el destino WhatsApp es el mismo numero vinculado; WhatsApp puede no mostrar notificacion push.`, order.user_id, order.id);
      const smtpConfig = await getSmtpConfig();
      if ((await getAdminNotificationEmail()) && smtpConfig.host && smtpConfig.from && smtpConfig.passwordConfigured) {
        const emailResult = await notifyAdminPaymentByEmail(order, payout, 'email_self_chat_fallback');
        if (emailResult !== 'email_failed') {
          await prisma.whatsAppOutbox.update({
            where: { id: outbox.id },
            data: {
              status: 'email_fallback',
              last_error: 'El destino era el mismo numero vinculado; respaldo enviado por correo.'
            }
          });
        }
      }
    }
    return 'whatsapp_pending';
  }

  await addMovement('admin.payment_notification_failed', `WhatsApp no disponible para orden ${order.order_number}; se intenta respaldo por correo.`, undefined, order.id);
  return notifyAdminPaymentByEmail(order, payout, 'email_fallback');
}

async function notifyAdminPaymentByEmail(order: any, payout: any, channel = 'email') {
  try {
    await sendAdminOrderNotificationEmail(order, payout, money, formatDateTimeCO, await getAdminNotificationEmail(), await getSmtpConfig());
    await prisma.order.update({ where: { id: order.id }, data: { admin_notified_at: new Date(), admin_notification_channel: 'email' } });
    await addMovement('admin.payment_notification_email_sent', `Correo enviado al admin para orden ${order.order_number}.`, order.user_id, order.id);
    return channel;
  } catch (error) {
    await prisma.order.update({ where: { id: order.id }, data: { admin_notification_channel: 'failed' } });
    await addMovement('admin.payment_notification_email_failed', `No se pudo enviar correo admin para orden ${order.order_number}: ${error instanceof Error ? error.message.slice(0, 140) : 'error desconocido'}.`, order.user_id, order.id);
    return 'email_failed';
  }
}

async function handleWhatsAppOutboxFinalFailure(
  item: { order_id: string | null; payout_id: string | null }
): Promise<WhatsAppOutboxFallbackResult> {
  if (!item.order_id || !item.payout_id) return 'skipped';
  const order = await prisma.order.findUnique({
    where: { id: item.order_id },
    include: { user: true, provider: true, items: { include: { product: true } }, providerPayouts: true }
  });
  const payout = await prisma.providerPayout.findUnique({ where: { id: item.payout_id } });
  if (!order || !payout) return 'skipped';
  if (order.admin_notification_channel === 'email') return 'email';
  if (order.admin_notification_channel === 'whatsapp') return 'whatsapp';
  await addMovement('admin.payment_notification_failed', `WhatsApp fallo definitivamente para orden ${order.order_number}; se intenta correo.`, undefined, order.id);
  const result = await notifyAdminPaymentByEmail(order, payout, 'email_after_whatsapp_failed');
  return result === 'email_failed' ? 'failed' : 'email';
}

const codeLoginSchema = z.object({ access_code: z.string().regex(/^\d{4}$/, 'El codigo debe tener 4 digitos.') });

app.get('/api/health', async (_req, res) => {
  const databaseHost = (() => {
    try {
      return new URL(process.env.DATABASE_URL || '').hostname;
    } catch {
      return '';
    }
  })();
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({
      ok: true,
      database: 'connected',
      databaseMode: databaseHost.includes('-pooler.') ? 'pooled' : 'direct'
    });
  } catch (error) {
    console.error('[health:database]', error instanceof Error ? error.message : error);
    const errorCode = typeof error === 'object' && error && 'code' in error ? String(error.code) : 'UNKNOWN';
    const rawMessage = error instanceof Error ? error.message : String(error);
    const errorReason =
      rawMessage.includes("Can't reach database server") ? 'unreachable' :
      rawMessage.includes('Authentication failed') ? 'authentication_failed' :
      rawMessage.includes('invalid') && rawMessage.includes('DATABASE_URL') ? 'invalid_url' :
      rawMessage.toLowerCase().includes('tls') || rawMessage.toLowerCase().includes('ssl') ? 'tls_error' :
      'unknown';
    res.status(503).json({
      ok: false,
      database: 'unavailable',
      databaseMode: databaseHost.includes('-pooler.') ? 'pooled' : 'direct',
      databaseHost,
      errorCode,
      errorReason
    });
  }
});
app.get('/favicon.ico', (_req, res) => res.status(204).end());

app.post('/api/auth/register', authLimiter, (_req, res) => {
  return res.status(410).json({ message: 'Registro publico desactivado. Cada usuario debe tener un codigo asignado por administracion.' });
});

app.post('/api/auth/login', authLimiter, async (req, res, next) => {
  try {
    const input = codeLoginSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { access_code: input.access_code } });
    if (!user) {
      return res.status(401).json({ message: 'Codigo incorrecto.' });
    }
    const authUser = publicUser(user);
    const token = signToken(authUser);
    res.json({ token, user: authUser });
    void addMovement('user.login', `Inicio de sesion: ${user.email}`, user.id).catch((error: unknown) => {
      console.error('[auth:login-audit]', error instanceof Error ? error.message : error);
    });
  } catch (error) {
    console.error('[auth:login]', error instanceof Error ? error.message : error);
    next(error);
  }
});

app.get('/api/auth/me', requireAuth, async (req, res, next) => {
  try {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
    res.json({ user: publicUser(user) });
  } catch (error) {
    next(error);
  }
});

app.get('/api/products', requireAuth, requireRole('client', 'admin'), async (_req, res, next) => {
  try {
    const products = await prisma.product.findMany({ where: { active: true }, orderBy: [{ category: 'asc' }, { price: 'asc' }] });
    res.json({ products: products.map((product) => serializeProduct(product, _req.user)) });
  } catch (error) {
    next(error);
  }
});

app.get('/api/admin/products', requireAuth, requireRole('admin'), async (_req, res, next) => {
  try {
    const products = await prisma.product.findMany({ orderBy: { created_at: 'desc' } });
    res.json({ products });
  } catch (error) {
    next(error);
  }
});

const productSchema = z.object({
  name: z.string().min(3),
  description: z.string().min(3),
  category: z.string().min(2),
  price: z.number().int().positive(),
  provider_cost: z.number().int().min(0).optional(),
  active: z.boolean(),
  brand_key: z.string().min(2),
  duration: z.string().optional(),
  screens: z.string().optional(),
  content_type: z.string().optional(),
  benefits: z.array(z.string()).optional()
});

app.post('/api/admin/products', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const input = productSchema.parse(req.body);
    const product = await prisma.product.create({ data: input });
    await addMovement('product.created', `Producto creado: ${product.name}`, req.user!.id);
    res.status(201).json({ product });
  } catch (error) {
    next(error);
  }
});

app.patch('/api/admin/products/:id', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const input = productSchema.partial().parse(req.body);
    const previous = await prisma.product.findUniqueOrThrow({ where: { id: paramId(req.params.id) } });
    const product = await prisma.product.update({ where: { id: paramId(req.params.id) }, data: input });
    const type =
      previous.active !== product.active
        ? product.active
          ? 'product.enabled'
          : 'product.disabled'
        : 'product.updated';
    await addMovement(type, `Producto actualizado: ${product.name}`, req.user!.id);
    res.json({ product });
  } catch (error) {
    next(error);
  }
});

const createOrderSchema = z.object({
  items: z.array(z.object({ productId: z.string(), quantity: z.number().int().min(1).max(20) })).min(1)
});

app.post('/api/orders', sensitiveLimiter, requireAuth, requireRole('client'), async (req, res, next) => {
  try {
    const input = createOrderSchema.parse(req.body);
    const productIds = input.items.map((item) => item.productId);
    const products = await prisma.product.findMany({ where: { id: { in: productIds }, active: true } });
    if (products.length !== productIds.length) return res.status(400).json({ message: 'Hay productos invalidos o inactivos.' });

    const provider = await prisma.user.findFirst({ where: { role: 'provider' }, orderBy: { created_at: 'asc' } });
    const providerPaymentConfig = await getProviderPaymentConfig(provider?.id);
    if (!providerPaymentConfig) return res.status(400).json({ message: 'No hay una configuracion activa de pago al proveedor.' });
    const productMap = new Map(products.map((product) => [product.id, product]));
    const orderItems = input.items.map((item) => {
      const product = productMap.get(item.productId)!;
      const providerCost = product.provider_cost > 0 ? product.provider_cost : Math.round(product.price * 0.55);
      return {
        product_id: product.id,
        product_name: product.name,
        quantity: item.quantity,
        unit_price: product.price,
        subtotal: product.price * item.quantity,
        providerSubtotal: providerCost * item.quantity
      };
    });
    const saleTotal = orderItems.reduce((sum, item) => sum + item.subtotal, 0);
    const providerTotal = orderItems.reduce((sum, item) => sum + item.providerSubtotal, 0);
    const profitTotal = saleTotal - providerTotal;
    const period = billingPeriod();
    const orderNumber = await generateOrderNumber();

    const result = await prisma.$transaction(async (tx) => {
      const order = await tx.order.create({
        data: {
          order_number: orderNumber,
          user_id: req.user!.id,
          provider_id: provider?.id,
          total: saleTotal,
          sale_total: saleTotal,
          provider_total: providerTotal,
          profit_total: profitTotal,
          status: 'admin_payment_pending',
          wallet_status: 'not_used',
          payout_status: 'pending_admin_payment',
          payment_status: 'admin_payment_pending',
          billing_period: period,
          whatsapp_sent: false,
          items: {
            create: orderItems.map(({ providerSubtotal, ...item }) => item)
          }
        },
        include: { user: true, provider: true, items: { include: { product: true } }, deliveries: true, payments: true, providerPayouts: true }
      });

      const payout = await tx.providerPayout.create({
        data: {
          order_id: order.id,
          provider_id: provider?.id,
          amount: providerTotal,
          currency: 'COP',
          method: providerPaymentConfig.method,
          status: 'pending_admin_payment',
          reference: `payout_${order.id}`,
          destination_type: providerPaymentConfig.method,
          destination_phone: providerPaymentConfig.phone,
          destination_document: providerPaymentConfig.document
        }
      });

      return { order, payout };
    });

    await addMovement('order.created', `Orden ${result.order.order_number} creada por ${result.order.user.email} por ${money(saleTotal)}.`, req.user!.id, result.order.id);
    await addMovement('provider_payout.pending_admin_payment', `Pago manual al proveedor pendiente por ${money(providerTotal)} para orden ${result.order.order_number}.`, req.user!.id, result.order.id);
    await notifyAdminPaymentPending(result.order, result.payout);

    res.status(201).json({
      order: serializeOrder(result.order, req.user),
      message: 'Pedido creado correctamente. Estamos procesando tu solicitud.'
    });
  } catch (error) {
    next(error);
  }
});

app.post('/api/webhooks/wallet', sensitiveLimiter, (_req, res) => {
  return res.status(410).json({ message: 'Webhook de pago automatico desactivado. El flujo actual usa pago manual del admin al proveedor.' });
});

app.post('/api/webhooks/provider-payout', sensitiveLimiter, async (req, res, next) => {
  try {
    return res.status(410).json({ message: 'Webhook de pago automatico desactivado. El pago al proveedor se gestiona manualmente por admin.' });
  } catch (error) {
    next(error);
  }
});
app.get('/api/orders', requireAuth, async (req, res, next) => {
  try {
    const where =
      req.user!.role === 'admin'
        ? {}
        : req.user!.role === 'provider'
          ? { status: { notIn: ['cancelled', 'payment_failed', 'payout_failed'] as any }, OR: [{ provider_id: req.user!.id }, { provider_id: null }] }
          : { user_id: req.user!.id };

    const orders = await prisma.order.findMany({
      where,
      include: { user: true, provider: true, items: { include: { product: true } }, deliveries: { include: { product: true } }, payments: { orderBy: { created_at: 'desc' }, take: 1 }, providerPayouts: { orderBy: { created_at: 'desc' }, take: 1 } },
      orderBy: { created_at: 'desc' }
    });
    res.json({ orders: orders.map((order) => serializeOrder(order, req.user)) });
  } catch (error) {
    next(error);
  }
});

app.get('/api/orders/:id', requireAuth, async (req, res, next) => {
  try {
    const order = await prisma.order.findUniqueOrThrow({
      where: { id: paramId(req.params.id) },
      include: { user: true, provider: true, items: { include: { product: true } }, deliveries: { include: { product: true } }, payments: { orderBy: { created_at: 'desc' }, take: 1 }, providerPayouts: { orderBy: { created_at: 'desc' }, take: 1 } }
    });
    const allowed =
      req.user!.role === 'admin' ||
      order.user_id === req.user!.id ||
      (req.user!.role === 'provider' && !['cancelled', 'payment_failed', 'payout_failed'].includes(order.status) && (!order.provider_id || order.provider_id === req.user!.id));
    if (!allowed) return res.status(403).json({ message: 'No puedes ver este pedido.' });
    res.json({ order: serializeOrder(order, req.user) });
  } catch (error) {
    next(error);
  }
});

const statusSchema = z.object({ status: z.enum(['admin_payment_pending', 'provider_delivery_pending', 'wallet_pending', 'payout_processing', 'pending_payment', 'paid', 'pending', 'processing', 'delivered', 'payout_failed', 'payment_failed', 'cancelled']) });

app.patch('/api/orders/:id/status', sensitiveLimiter, requireAuth, requireRole('provider', 'admin'), async (req, res, next) => {
  try {
    const { status } = statusSchema.parse(req.body);
    const order = await prisma.order.findUniqueOrThrow({ where: { id: paramId(req.params.id) } });
    if (req.user!.role === 'provider' && order.provider_id && order.provider_id !== req.user!.id) {
      return res.status(403).json({ message: 'Este pedido esta asignado a otro proveedor.' });
    }
    if (req.user!.role === 'provider' && ['delivered', 'cancelled', 'payment_failed', 'payout_failed'].includes(order.status)) {
      return res.status(403).json({ message: 'Solo puedes gestionar pedidos liberados por admin.' });
    }
    if (req.user!.role === 'provider' && !['processing'].includes(status)) {
      return res.status(403).json({ message: 'El proveedor no puede modificar estados financieros.' });
    }
    const updated = await prisma.order.update({
      where: { id: paramId(req.params.id) },
      data: {
        status,
        provider_id: req.user!.role === 'provider' ? req.user!.id : order.provider_id
      },
      include: { user: true, provider: true, items: { include: { product: true } }, deliveries: { include: { product: true } }, payments: { orderBy: { created_at: 'desc' }, take: 1 }, providerPayouts: { orderBy: { created_at: 'desc' }, take: 1 } }
    });
    await addMovement('order.status_changed', `Orden ${updated.order_number} cambio a ${status}.`, req.user!.id, updated.id);
    res.json({ order: serializeOrder(updated, req.user) });
  } catch (error) {
    next(error);
  }
});

const deliverySchema = z.object({
  order_item_id: z.string(),
  delivered_email: z.string().min(3),
  delivered_password: z.string().min(1),
  profile_name: z.string().optional(),
  pin: z.string().optional(),
  notes: z.string().optional(),
  markDelivered: z.boolean().default(true)
});

app.post('/api/orders/:id/deliveries', sensitiveLimiter, requireAuth, requireRole('provider', 'admin'), async (req, res, next) => {
  try {
    const input = deliverySchema.parse(req.body);
    const order = await prisma.order.findUniqueOrThrow({
      where: { id: paramId(req.params.id) },
      include: { user: true, items: true }
    });
    if (req.user!.role === 'provider' && order.provider_id && order.provider_id !== req.user!.id) {
      return res.status(403).json({ message: 'Este pedido esta asignado a otro proveedor.' });
    }
    if (req.user!.role === 'provider' && ['delivered', 'cancelled', 'payment_failed', 'payout_failed'].includes(order.status)) {
      return res.status(403).json({ message: 'Este pedido ya no esta pendiente de entrega.' });
    }
    const item = order.items.find((orderItem) => orderItem.id === input.order_item_id);
    if (!item) return res.status(400).json({ message: 'El item no pertenece al pedido.' });
    const existingDeliveries = await prisma.deliveredAccount.count({ where: { order_id: order.id, order_item_id: item.id } });
    if (existingDeliveries >= item.quantity) return res.status(400).json({ message: 'Este producto ya fue entregado completamente.' });

    await prisma.deliveredAccount.create({
      data: {
        order_id: order.id,
        order_item_id: item.id,
        product_id: item.product_id,
        delivered_email: input.delivered_email,
        delivered_password: encryptSecret(input.delivered_password),
        profile_name: input.profile_name,
        pin: input.pin,
        notes: input.notes,
        delivered_by: req.user!.id
      }
    });

    const deliveryCounts = await prisma.deliveredAccount.groupBy({
      by: ['order_item_id'],
      where: { order_id: order.id },
      _count: { id: true }
    });
    const countByItem = new Map(deliveryCounts.map((entry) => [entry.order_item_id, entry._count.id]));
    const allItemsDelivered = order.items.every((orderItem) => (countByItem.get(orderItem.id) || 0) >= orderItem.quantity);

    const updated = await prisma.order.update({
      where: { id: order.id },
      data: {
        status: input.markDelivered && allItemsDelivered ? 'delivered' : 'processing',
        provider_id: req.user!.role === 'provider' ? req.user!.id : order.provider_id
      },
      include: { user: true, provider: true, items: { include: { product: true } }, deliveries: { include: { product: true } }, payments: { orderBy: { created_at: 'desc' }, take: 1 }, providerPayouts: { orderBy: { created_at: 'desc' }, take: 1 } }
    });
    await addMovement('account.delivered', `Cuenta cargada para ${item.product_name} en orden ${order.order_number}.`, req.user!.id, order.id);
    await createNotification(
      order.user_id,
      order.id,
      'account.delivered',
      'Tu cuenta ya esta disponible',
      `Tu cuenta ya esta disponible. Orden ${order.order_number}.`
    );
    await prisma.order.update({ where: { id: order.id }, data: { client_notified_at: new Date() } });
    await addMovement('client.notification_created', `Cliente notificado por cuenta disponible en orden ${order.order_number}.`, order.user_id, order.id);
    if (process.env.CLIENT_WHATSAPP_NOTIFICATIONS_ENABLED === 'true' && order.user.phone) {
      await queueWhatsAppNotification(prisma, {
        recipient: order.user.phone,
        message: `Tu cuenta ya esta disponible en la plataforma. Orden ${order.order_number}. Ingresa a tu panel para ver los datos de acceso.`,
        orderId: order.id
      });
      await addMovement('client.whatsapp_notification_created', `Aviso de cuenta disponible encolado para orden ${order.order_number}.`, req.user!.id, order.id);
    }
    res.status(201).json({ order: serializeOrder(updated, req.user) });
  } catch (error) {
    next(error);
  }
});

app.get('/api/provider/deliveries', requireAuth, requireRole('provider'), async (req, res, next) => {
  try {
    const deliveries = await prisma.deliveredAccount.findMany({
      where: { delivered_by: req.user!.id },
      include: {
        order: { include: { user: true } },
        orderItem: true,
        product: true
      },
      orderBy: { delivered_at: 'desc' },
      take: 100
    });
    res.json({
      deliveries: deliveries.map((delivery) => ({
        id: delivery.id,
        order_id: delivery.order_id,
        order_number: delivery.order.order_number,
        order_item_id: delivery.order_item_id,
        product_id: delivery.product_id,
        product_name: delivery.orderItem.product_name,
        client_name: delivery.order.user.name,
        status: delivery.order.status,
        delivered_email: delivery.delivered_email,
        profile_name: delivery.profile_name,
        pin: delivery.pin ? 'Registrado' : null,
        notes: delivery.notes,
        delivered_at: delivery.delivered_at
      }))
    });
  } catch (error) {
    next(error);
  }
});

app.get('/api/notifications', requireAuth, requireRole('client'), async (req, res, next) => {
  try {
    const notifications = await prisma.notification.findMany({
      where: { user_id: req.user!.id },
      orderBy: { created_at: 'desc' },
      take: 50
    });
    res.json({ notifications });
  } catch (error) {
    next(error);
  }
});

app.get('/api/notifications/unread-count', requireAuth, requireRole('client'), async (req, res, next) => {
  try {
    const count = await prisma.notification.count({ where: { user_id: req.user!.id, read: false } });
    res.json({ count });
  } catch (error) {
    next(error);
  }
});

app.patch('/api/notifications/:id/read', sensitiveLimiter, requireAuth, requireRole('client'), async (req, res, next) => {
  try {
    const notification = await prisma.notification.findUniqueOrThrow({ where: { id: paramId(req.params.id) } });
    if (notification.user_id !== req.user!.id) return res.status(403).json({ message: 'No puedes modificar esta notificacion.' });
    const updated = await prisma.notification.update({
      where: { id: notification.id },
      data: { read: true, read_at: new Date() }
    });
    res.json({ notification: updated });
  } catch (error) {
    next(error);
  }
});

app.get('/api/admin/dashboard', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const [
      orders,
      usersCount,
      activeProducts,
      deliveredAccounts,
      recentOrders,
      movements,
      notificationSent,
      notificationPending,
      notificationFailed,
      lastProviderNotified,
      payments,
      latestPayments,
      receiptSent,
      receiptFailed,
      clients,
      providerPayouts,
      latestProviderPayouts,
      deliveryDraftsPending,
      whatsappInboundReceived,
      whatsappInboundAutoDelivered,
      whatsappInboundDrafts,
      whatsappInboundFailed
    ] = await Promise.all([
      prisma.order.findMany(),
      prisma.user.count(),
      prisma.product.count({ where: { active: true } }),
      prisma.deliveredAccount.count(),
      prisma.order.findMany({
        take: 8,
        include: { user: true, provider: true, items: true, deliveries: true, payments: { orderBy: { created_at: 'desc' }, take: 1 }, providerPayouts: { orderBy: { created_at: 'desc' }, take: 1 } },
        orderBy: { created_at: 'desc' }
      }),
      prisma.movement.findMany({ take: 16, include: { user: true, order: true }, orderBy: { created_at: 'desc' } }),
      prisma.whatsAppOutbox.count({ where: { status: 'sent' } }),
      prisma.whatsAppOutbox.count({ where: { status: 'pending' } }),
      prisma.whatsAppOutbox.count({ where: { status: 'failed' } }),
      prisma.whatsAppOutbox.findFirst({ where: { status: 'sent' }, orderBy: { sent_at: 'desc' } }),
      prisma.payment.findMany(),
      prisma.payment.findMany({ take: 10, include: { order: { include: { user: true } } }, orderBy: { created_at: 'desc' } }),
      prisma.movement.count({ where: { type: 'payment.receipt_sent_to_provider' } }),
      prisma.movement.count({ where: { type: 'payment.receipt_send_failed' } }),
      prisma.user.findMany({ where: { role: 'client' }, orderBy: { created_at: 'desc' } }),
      prisma.providerPayout.findMany(),
      prisma.providerPayout.findMany({ take: 10, include: { order: { include: { user: true } } }, orderBy: { created_at: 'desc' } }),
      prisma.deliveryDraft.count({ where: { status: 'needs_review' } }),
      prisma.whatsAppInboundMessage.count(),
      prisma.whatsAppInboundMessage.count({ where: { status: 'auto_delivered' } }),
      prisma.whatsAppInboundMessage.count({ where: { status: 'draft_created' } }),
      prisma.whatsAppInboundMessage.count({ where: { status: 'failed' } })
    ]);
    const receiptMovements = await prisma.movement.findMany({
      where: {
        order_id: { in: latestPayments.map((payment) => payment.order_id) },
        type: { in: ['payment.receipt_sent_to_provider', 'payment.receipt_send_failed'] }
      },
      orderBy: { created_at: 'desc' }
    });
    const receiptStatusByOrder = new Map(
      receiptMovements.map((movement) => [
        movement.order_id,
        movement.type === 'payment.receipt_sent_to_provider' ? 'sent' : 'failed'
      ])
    );
    const confirmedOrders = orders.filter((order) => order.status !== 'cancelled');
    const confirmedPayouts = providerPayouts.filter((payout) => payout.status === 'receipt_sent_to_provider');
    const confirmedPayments = payments.filter((payment) => payment.status === 'confirmed');
    const totalSold = confirmedOrders.reduce((sum, order) => sum + (order.sale_total || order.total), 0);
    const totalProviderPaid = confirmedOrders.reduce((sum, order) => sum + order.provider_total, 0);
    const totalProfit = totalSold - totalProviderPaid;
    const todaySold = confirmedOrders.filter((order) => order.created_at >= today).reduce((sum, order) => sum + (order.sale_total || order.total), 0);
    const currentPeriod = billingPeriod();
    const monthlyOrders = confirmedOrders.filter((order) => order.billing_period === currentPeriod);
    res.json({
      kpis: {
        totalSold,
        totalProviderPaid,
        totalProfit,
        todaySold,
        todayOrders: orders.filter((order) => order.created_at >= today).length,
        payoutProcessingOrders: orders.filter((order) => order.status !== 'delivered' && order.status !== 'cancelled').length,
        pendingPaymentOrders: orders.filter((order) => order.status === 'pending_payment').length,
        pendingOrders: orders.filter((order) => order.status !== 'delivered' && order.status !== 'cancelled').length,
        processingOrders: orders.filter((order) => order.status === 'processing').length,
        deliveredOrders: orders.filter((order) => order.status === 'delivered').length,
        payoutFailedOrders: orders.filter((order) => order.status === 'payout_failed').length,
        paymentFailedOrders: orders.filter((order) => order.status === 'payment_failed').length,
        cancelledOrders: orders.filter((order) => order.status === 'cancelled').length,
        providerPayoutConfirmed: confirmedPayouts.length,
        providerPayoutPending: providerPayouts.filter((payout) => payout.status === 'pending_admin_payment').length,
        providerPayoutFailed: providerPayouts.filter((payout) => payout.status === 'failed').length,
        pendingPayments: payments.filter((payment) => payment.status === 'pending').length,
        confirmedPayments: confirmedPayments.length,
        failedPayments: payments.filter((payment) => payment.status === 'failed').length,
        receiptSent,
        receiptFailed,
        usersCount,
        activeProducts,
        deliveredAccounts,
        notificationSent,
        notificationPending,
        notificationFailed,
        deliveryDraftsPending,
        whatsappInboundReceived,
        whatsappInboundAutoDelivered,
        whatsappInboundDrafts,
        whatsappInboundFailed,
        lastProviderNotified: lastProviderNotified?.sent_at || null
      },
      recentOrders: recentOrders.map((order) => serializeOrder(order, req.user)),
      providerPayouts: latestProviderPayouts.map((payout) => ({
        id: payout.id,
        order_id: payout.order_id,
        amount: payout.amount,
        currency: payout.currency,
        method: payout.method,
        status: payout.status,
        transaction_id: payout.transaction_id,
        reference: payout.reference,
        destination_type: payout.destination_type,
        confirmed_at: payout.confirmed_at,
        created_at: payout.created_at,
        order: {
          id: payout.order.id,
          order_number: payout.order.order_number,
          user: safeUser(payout.order.user, true),
          sale_total: payout.order.sale_total,
          provider_total: payout.order.provider_total,
          profit_total: payout.order.profit_total,
          status: payout.order.status
        }
      })),
      monthlyStatements: clients.map((client) => {
        const clientOrders = monthlyOrders.filter((order) => order.user_id === client.id);
        return {
          month: currentPeriod,
          client: safeUser(client, true),
          totalSold: clientOrders.reduce((sum, order) => sum + (order.sale_total || order.total), 0),
          totalProviderPaid: clientOrders.reduce((sum, order) => sum + order.provider_total, 0),
          profit: clientOrders.reduce((sum, order) => sum + order.profit_total, 0),
          orders: clientOrders.length,
          status: 'open'
        };
      }),
      latestPayments: latestPayments.map((payment) => ({
        id: payment.id,
        order_id: payment.order_id,
        provider: payment.provider,
        method: payment.method,
        status: payment.status,
        amount: payment.amount,
        currency: payment.currency,
        transaction_id: payment.transaction_id,
        reference: payment.reference,
        receipt_status: receiptStatusByOrder.get(payment.order_id) || 'pending',
        confirmed_at: payment.confirmed_at,
        created_at: payment.created_at,
        order: {
          id: payment.order.id,
          order_number: payment.order.order_number,
          user: safeUser(payment.order.user, true),
          total: payment.order.total,
          status: payment.order.status
        }
      })),
      movements
    });
  } catch (error) {
    next(error);
  }
});

app.get('/api/admin/users', requireAuth, requireRole('admin'), async (_req, res, next) => {
  try {
    const users = await prisma.user.findMany({ orderBy: { created_at: 'desc' } });
    res.json({ users: users.map(publicUser) });
  } catch (error) {
    next(error);
  }
});

app.get('/api/admin/orders/pending-delivery', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const orders = await prisma.order.findMany({
      where: {
        status: { notIn: ['delivered', 'cancelled', 'payment_failed', 'payout_failed'] as any },
        user: {
          role: 'client',
          OR: [{ name: { contains: 'Servimil', mode: 'insensitive' } }, { email: 'cliente@centrodigital.local' }]
        }
      },
      include: { user: true, provider: true, items: { include: { product: true, deliveries: { include: { product: true } } } }, deliveries: { include: { product: true } }, payments: true, providerPayouts: true },
      orderBy: { created_at: 'desc' }
    });
    res.json({
      orders: orders.map((order) => {
        const serialized = serializeOrder(order, req.user);
        return {
          ...serialized,
          items: serialized.items.map((item: any) => ({
            ...item,
            delivered_quantity: item.delivered_accounts?.length || 0,
            pending_quantity: Math.max(item.quantity - (item.delivered_accounts?.length || 0), 0)
          }))
        };
      })
    });
  } catch (error) {
    next(error);
  }
});

const adminOrderEditSchema = z.object({
  status: z.enum(orderStatusValues).optional(),
  sale_total: z.number().int().min(0).optional(),
  provider_total: z.number().int().min(0).optional(),
  profit_total: z.number().int().optional(),
  payout_status: z.string().optional()
});

app.patch('/api/admin/orders/:id', sensitiveLimiter, requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const input = adminOrderEditSchema.parse(req.body);
    const order = await prisma.order.findUniqueOrThrow({ where: { id: paramId(req.params.id) } });
    const saleTotal = input.sale_total ?? order.sale_total;
    const providerTotal = input.provider_total ?? order.provider_total;
    const profitTotal = input.profit_total ?? (saleTotal - providerTotal);
    const updated = await prisma.$transaction(async (tx) => {
      const updatedOrder = await tx.order.update({
        where: { id: order.id },
        data: {
          status: input.status ?? order.status,
          total: saleTotal,
          sale_total: saleTotal,
          provider_total: providerTotal,
          profit_total: profitTotal,
          payout_status: input.payout_status ?? order.payout_status,
          delivered_at: input.status === 'delivered' ? (order.delivered_at || new Date()) : order.delivered_at
        },
        include: { user: true, provider: true, items: { include: { product: true } }, deliveries: { include: { product: true } }, payments: true, providerPayouts: true }
      });
      if (input.provider_total !== undefined) {
        await tx.providerPayout.updateMany({
          where: { order_id: order.id, status: { in: ['pending_admin_payment', 'receipt_sent_to_provider'] } },
          data: { amount: providerTotal }
        });
      }
      return updatedOrder;
    });
    await addMovement('order.admin_updated', `Admin edito orden ${updated.order_number}: venta ${money(saleTotal)}, proveedor ${money(providerTotal)}, utilidad ${money(profitTotal)}, estado ${updated.status}.`, req.user!.id, updated.id);
    res.json({ order: serializeOrder(updated, req.user) });
  } catch (error) {
    next(error);
  }
});

app.get('/api/admin/logs', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const [outbox, movements] = await Promise.all([
      prisma.whatsAppOutbox.findMany({
        orderBy: { updated_at: 'desc' },
        take: 80
      }),
      prisma.movement.findMany({
        where: {
          OR: [
            { type: { contains: 'failed', mode: 'insensitive' } },
            { type: { contains: 'whatsapp', mode: 'insensitive' } },
            { type: { contains: 'admin', mode: 'insensitive' } },
            { type: { contains: 'delivery', mode: 'insensitive' } }
          ]
        },
        include: { user: true, order: true },
        orderBy: { created_at: 'desc' },
        take: 80
      })
    ]);
    const orderIds = Array.from(new Set(outbox.map((item) => item.order_id).filter(Boolean))) as string[];
    const orderLabels = new Map(
      (await prisma.order.findMany({ where: { id: { in: orderIds } }, select: { id: true, order_number: true } }))
        .map((order) => [order.id, order.order_number])
    );
    const logs = [
      ...outbox.map((item) => ({
        id: `whatsapp-${item.id}`,
        source: 'whatsapp',
        type: 'whatsapp.outbox',
        status: item.status,
        description: item.message.slice(0, 180),
        order_label: item.order_id ? orderLabels.get(item.order_id) || item.order_id.slice(0, 8) : null,
        attempts: item.attempts,
        last_error: item.last_error,
        created_at: item.created_at,
        updated_at: item.updated_at
      })),
      ...movements.map((movement) => ({
        id: `movement-${movement.id}`,
        source: 'movement',
        type: movement.type,
        status: undefined,
        description: movement.description,
        order_label: movement.order?.order_number || null,
        attempts: undefined,
        last_error: movement.type.includes('failed') ? movement.description : null,
        created_at: movement.created_at,
        updated_at: movement.created_at
      }))
    ].sort((a, b) => new Date(b.updated_at || b.created_at).getTime() - new Date(a.updated_at || a.created_at).getTime()).slice(0, 120);
    res.json({ logs });
  } catch (error) {
    next(error);
  }
});

app.get('/api/admin/payouts/pending', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const payouts = await prisma.providerPayout.findMany({
      where: { status: 'pending_admin_payment' },
      include: { order: { include: { user: true, provider: true, items: true, deliveries: true, payments: true, providerPayouts: true } } },
      orderBy: { created_at: 'desc' }
    });
    res.json({
      payouts: payouts.map((payout) => ({
        id: payout.id,
        order_id: payout.order_id,
        amount: payout.amount,
        currency: payout.currency,
        method: payout.method,
        status: payout.status,
        reference: payout.reference,
        destination_type: payout.destination_type,
        destination_phone: payout.destination_phone,
        created_at: payout.created_at,
        order: serializeOrder(payout.order, req.user)
      }))
    });
  } catch (error) {
    next(error);
  }
});

const markReceiptSentSchema = z.object({
  admin_payment_reference: z.string().optional(),
  admin_payment_notes: z.string().optional()
});

app.patch('/api/admin/payouts/:id/mark-receipt-sent', sensitiveLimiter, requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const input = markReceiptSentSchema.parse(req.body);
    const payout = await prisma.providerPayout.findUniqueOrThrow({ where: { id: paramId(req.params.id) }, include: { order: true } });
    if (payout.status !== 'pending_admin_payment') return res.status(400).json({ message: 'Este payout no esta pendiente de pago admin.' });
    const updated = await prisma.$transaction(async (tx) => {
      const updatedPayout = await tx.providerPayout.update({
        where: { id: payout.id },
        data: {
          status: 'receipt_sent_to_provider',
          admin_payment_reference: input.admin_payment_reference || null,
          admin_payment_notes: input.admin_payment_notes || null,
          admin_marked_by: req.user!.id,
          admin_marked_at: new Date()
        }
      });
      const updatedOrder = await tx.order.update({
        where: { id: payout.order_id },
        data: { status: 'provider_delivery_pending', payout_status: 'receipt_sent_to_provider', provider_payment_marked_at: new Date() },
        include: { user: true, provider: true, items: true, deliveries: true, payments: true, providerPayouts: true }
      });
      return { payout: updatedPayout, order: updatedOrder };
    });
    await addMovement('provider_payout.receipt_sent_to_provider', `Admin marco comprobante enviado para orden ${updated.order.order_number}.`, req.user!.id, updated.order.id);
    await addMovement('order.released_to_provider', `Orden ${updated.order.order_number} liberada al proveedor.`, req.user!.id, updated.order.id);
    res.json({ payout: updated.payout, order: serializeOrder(updated.order, req.user) });
  } catch (error) {
    next(error);
  }
});

app.patch('/api/admin/payouts/:id/cancel', sensitiveLimiter, requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const payout = await prisma.providerPayout.findUniqueOrThrow({ where: { id: paramId(req.params.id) }, include: { order: true } });
    const updated = await prisma.$transaction(async (tx) => {
      const updatedPayout = await tx.providerPayout.update({ where: { id: payout.id }, data: { status: 'cancelled' } });
      const updatedOrder = await tx.order.update({
        where: { id: payout.order_id },
        data: { status: 'cancelled', payout_status: 'cancelled' },
        include: { user: true, provider: true, items: true, deliveries: true, payments: true, providerPayouts: true }
      });
      return { payout: updatedPayout, order: updatedOrder };
    });
    await addMovement('order.status_changed', `Admin cancelo orden ${updated.order.order_number}.`, req.user!.id, updated.order.id);
    res.json({ payout: updated.payout, order: serializeOrder(updated.order, req.user) });
  } catch (error) {
    next(error);
  }
});

const providerConfigSchema = z.object({
  provider_name: z.string().min(2),
  provider_whatsapp_number: z.string().optional(),
  admin_notification_phone: z.string().optional(),
  admin_notification_email: z.string().optional(),
  provider_notifications_active: z.boolean(),
  provider_notification_method: z.enum(['bridge', 'internal']),
  provider_payment_method: z.enum(['nequi', 'daviplata', 'bancolombia']),
  provider_payment_phone: z.string().min(7),
  provider_document: z.string().optional(),
  provider_payment_active: z.boolean()
});

app.get('/api/admin/whatsapp/status', sensitiveLimiter, requireAuth, requireRole('admin'), async (_req, res, next) => {
  try {
    res.json({ status: await getWhatsAppBridgeStatus(prisma) });
  } catch (error) {
    next(error);
  }
});

app.get('/api/admin/whatsapp/qr', sensitiveLimiter, requireAuth, requireRole('admin'), async (_req, res, next) => {
  try {
    res.json({ qr: getWhatsAppBridgeQr() });
  } catch (error) {
    next(error);
  }
});

app.post('/api/admin/whatsapp/connect', sensitiveLimiter, requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    enableWhatsAppBridge();
    await upsertSetting('whatsapp_bridge_admin_enabled', 'true');
    void startWhatsAppBridgeWorker(prisma, addMovement, processInboundDeliveryMessage, handleWhatsAppOutboxFinalFailure)
      .catch((error: unknown) => {
        console.error('[whatsapp:connect]', error instanceof Error ? error.message : error);
      });
    await addMovement('whatsapp.connection_requested', 'Admin inicio la vinculacion de WhatsApp Bridge.', req.user!.id);
    res.status(202).json({
      status: await getWhatsAppBridgeStatus(prisma),
      message: 'Vinculacion iniciada. El QR aparecera en unos segundos.'
    });
  } catch (error) {
    next(error);
  }
});

app.post('/api/admin/whatsapp/retry-failed', sensitiveLimiter, requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    await retryFailedWhatsAppOutbox(prisma);
    await addMovement('whatsapp.retry_failed', 'Admin reintento mensajes fallidos del WhatsApp Bridge.', req.user!.id);
    res.json({ status: await getWhatsAppBridgeStatus(prisma) });
  } catch (error) {
    next(error);
  }
});

app.post('/api/admin/whatsapp/disconnect', sensitiveLimiter, requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    await disconnectWhatsAppBridge();
    await upsertSetting('whatsapp_bridge_admin_enabled', 'false');
    await addMovement('whatsapp.disconnected', 'Admin desconecto la sesion de WhatsApp Bridge.', req.user!.id);
    res.json({ status: await getWhatsAppBridgeStatus(prisma) });
  } catch (error) {
    next(error);
  }
});

app.post('/api/admin/whatsapp/test', sensitiveLimiter, requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const adminNumber = await getAdminNotificationPhone();
    if (!adminNumber) return res.status(400).json({ message: 'Configura primero el numero WhatsApp del admin.' });
    await queueWhatsAppNotification(prisma, {
      recipient: adminNumber,
      message: `Mensaje de prueba Centro Digital. Fecha: ${formatDateTimeCO(new Date())}`
    });
    await addMovement('whatsapp.outbox_created', 'Mensaje de prueba al WhatsApp del admin agregado a cola.', req.user!.id);
    res.json({ status: await getWhatsAppBridgeStatus(prisma), message: 'Mensaje de prueba agregado a la cola.' });
  } catch (error) {
    next(error);
  }
});

app.get('/api/admin/whatsapp/inbound', sensitiveLimiter, requireAuth, requireRole('admin'), async (_req, res, next) => {
  try {
    const messages = await prisma.whatsAppInboundMessage.findMany({
      orderBy: { created_at: 'desc' },
      take: 80
    });
    res.json({
      messages: messages.map((message) => ({
        id: message.id,
        from: normalizePhone(message.from).replace(/\d(?=\d{4})/g, '*'),
        body_preview: message.body.slice(0, 240),
        status: message.status,
        created_at: message.created_at
      }))
    });
  } catch (error) {
    next(error);
  }
});

const simulateInboundSchema = z.object({
  from: z.string().min(4).default('admin-simulado'),
  body: z.string().min(3)
});

app.post('/api/admin/whatsapp/inbound/simulate', sensitiveLimiter, requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    if (process.env.NODE_ENV === 'production') return res.status(403).json({ message: 'La simulacion de WhatsApp entrante solo esta disponible fuera de produccion.' });
    const input = simulateInboundSchema.parse(req.body);
    await processInboundDeliveryMessage({
      whatsappMessageId: `sim_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
      from: input.from,
      body: input.body,
      raw: { simulated_by: req.user!.id }
    });
    res.json({ message: 'Mensaje entrante simulado y procesado.' });
  } catch (error) {
    next(error);
  }
});

app.patch('/api/admin/admin-notification-config', sensitiveLimiter, requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const input = z.object({
      admin_notification_phone: z.string().optional(),
      admin_notification_email: z.union([z.string().email(), z.literal('')]).optional()
    }).parse(req.body);
    await upsertSetting('admin_notification_phone', input.admin_notification_phone || '');
    await upsertSetting('admin_notification_email', input.admin_notification_email || '');
    await addMovement('admin.notification_config_updated', 'Admin actualizo el WhatsApp/correo de avisos.', req.user!.id);
    res.json({
      admin_notification_phone: input.admin_notification_phone || '',
      admin_notification_email: input.admin_notification_email || ''
    });
  } catch (error) {
    next(error);
  }
});

const smtpConfigSchema = z.object({
  host: z.string().trim().min(3),
  port: z.coerce.number().int().min(1).max(65535),
  secure: z.boolean(),
  user: z.string().trim().optional(),
  password: z.string().optional(),
  from: z.string().trim().min(3)
});

app.get('/api/admin/email/status', sensitiveLimiter, requireAuth, requireRole('admin'), async (_req, res, next) => {
  try {
    res.json({ status: await getEmailStatus() });
  } catch (error) {
    next(error);
  }
});

app.patch('/api/admin/email/config', sensitiveLimiter, requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const input = smtpConfigSchema.parse(req.body);
    const updates = [
      upsertSetting('smtp_host', input.host),
      upsertSetting('smtp_port', String(input.port)),
      upsertSetting('smtp_secure', String(input.secure)),
      upsertSetting('smtp_user', input.user || ''),
      upsertSetting('smtp_from', input.from)
    ];
    if (input.password?.trim()) {
      updates.push(upsertSetting('smtp_pass_encrypted', encryptSecret(input.password.trim()) || ''));
    }
    await Promise.all(updates);
    await upsertSetting('smtp_last_test_status', 'pending');
    await upsertSetting('smtp_last_test_error', '');
    await addMovement('email.config_updated', 'Admin actualizo la configuracion SMTP cifrada.', req.user!.id);
    res.json({ status: await getEmailStatus() });
  } catch (error) {
    next(error);
  }
});

app.post('/api/admin/email/test', sensitiveLimiter, requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const recipient = await getAdminNotificationEmail();
    if (!recipient) return res.status(400).json({ message: 'Configura primero el correo de avisos del admin.' });
    const config = await getSmtpConfig();
    if (!emailConfigured(config)) {
      return res.status(400).json({
        message: config.user && !config.pass
          ? 'Guarda primero la contrasena de aplicacion del correo.'
          : 'Completa primero la configuracion SMTP.'
      });
    }

    try {
      await verifySmtpConnection(config);
      await sendSmtpEmail({
        to: recipient,
        subject: 'Prueba de correo - Centro Digital',
        text: `La vinculacion de correo funciona correctamente.\n\nFecha: ${formatDateTimeCO(new Date())}`
      }, config);
      await Promise.all([
        upsertSetting('smtp_last_test_status', 'sent'),
        upsertSetting('smtp_last_test_at', new Date().toISOString()),
        upsertSetting('smtp_last_test_error', '')
      ]);
      await addMovement('email.test_sent', `Correo de prueba enviado a ${recipient}.`, req.user!.id);
      return res.json({ status: await getEmailStatus(), message: 'Correo de prueba enviado correctamente.' });
    } catch (error) {
      const safeMessage = error instanceof Error ? error.message.replace(/[\r\n]+/g, ' ').slice(0, 180) : 'Error SMTP desconocido';
      await Promise.all([
        upsertSetting('smtp_last_test_status', 'failed'),
        upsertSetting('smtp_last_test_at', new Date().toISOString()),
        upsertSetting('smtp_last_test_error', safeMessage)
      ]);
      await addMovement('email.test_failed', `Fallo la prueba SMTP: ${safeMessage}.`, req.user!.id);
      return res.status(502).json({ message: `No se pudo enviar el correo: ${safeMessage}`, status: await getEmailStatus() });
    }
  } catch (error) {
    next(error);
  }
});

const deliveryParserPreviewSchema = z.object({
  orderId: z.string().optional(),
  orderNumber: z.string().optional(),
  rawText: z.string().min(3)
});

app.post('/api/admin/delivery-parser/preview', sensitiveLimiter, requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const input = deliveryParserPreviewSchema.parse(req.body);
    const normalizedOrderNumber = normalizeOrderNumberInput(input.orderNumber);
    const orderWhere = input.orderId ? { id: input.orderId } : normalizedOrderNumber ? { order_number: normalizedOrderNumber } : null;
    if (!orderWhere) return res.status(400).json({ message: 'Selecciona una orden pendiente antes de interpretar el mensaje.' });
    const order = await prisma.order.findUniqueOrThrow({
      where: orderWhere,
      include: { user: true, provider: true, items: { include: { product: true } }, deliveries: { include: { product: true } }, payments: true, providerPayouts: true }
    });
    if (!isPendingDeliveryStatus(order.status)) return res.status(400).json({ message: 'Esta orden ya no esta pendiente de entrega.' });
    if (!isServimilUser(order.user)) return res.status(403).json({ message: 'Solo se pueden procesar ordenes del cliente Servimil.' });
    const preview = parseDeliveryMessage(input.rawText, order);
    await addMovement('delivery.message_parsed', `Admin interpreto mensaje de entrega para orden ${order.order_number}.`, req.user!.id, order.id);
    res.json({ preview, order: serializeOrder(order, req.user) });
  } catch (error) {
    next(error);
  }
});

const deliveryParserItemSchema = z.object({
  serviceName: z.string().min(1),
  matchedProductId: z.string().optional(),
  matchedOrderItemId: z.string().optional(),
  delivered_email: z.string().optional(),
  delivered_user: z.string().optional(),
  delivered_password: z.string().optional(),
  profile_name: z.string().optional(),
  pin: z.string().optional(),
  iptv_url: z.string().optional(),
  notes: z.string().optional(),
  confidence: z.number().optional(),
  needsReview: z.boolean().optional(),
  incompatible: z.boolean().optional(),
  incompatibleReason: z.string().optional()
});

const deliveryParserApproveSchema = z.object({
  orderId: z.string().optional(),
  orderNumber: z.string().optional(),
  rawText: z.string().min(3),
  items: z.array(deliveryParserItemSchema).min(1)
});

app.post('/api/admin/delivery-parser/approve', sensitiveLimiter, requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const input = deliveryParserApproveSchema.parse(req.body);
    const normalizedOrderNumber = normalizeOrderNumberInput(input.orderNumber);
    const orderWhere = input.orderId ? { id: input.orderId } : normalizedOrderNumber ? { order_number: normalizedOrderNumber } : null;
    if (!orderWhere) return res.status(400).json({ message: 'No se puede aprobar sin orden seleccionada.' });
    const order = await prisma.order.findUniqueOrThrow({
      where: orderWhere,
      include: { user: true, provider: true, items: { include: { product: true } }, deliveries: { include: { product: true } }, payments: true, providerPayouts: true }
    });
    if (!isPendingDeliveryStatus(order.status)) return res.status(400).json({ message: 'Esta orden ya no esta pendiente de entrega.' });
    if (!isServimilUser(order.user)) return res.status(403).json({ message: 'Solo se pueden aprobar entregas de Servimil.' });
    const compatibleItems = (input.items as DeliveryParserItem[]).filter((item) => !item.incompatible && item.matchedOrderItemId && item.matchedProductId);
    if (!compatibleItems.length) return res.status(400).json({ message: 'No hay cuentas compatibles con la orden seleccionada para aprobar.' });
    const { updated, created } = await createDeliveriesFromAdminItems(order, compatibleItems, req.user!.id);
    if (!created) return res.status(400).json({ message: 'No se crearon entregas nuevas. Revisa duplicados o productos ya entregados.' });
    await addMovement('delivery.approved', `Admin aprobo ${created} cuenta(s) desde mensaje pegado para orden ${order.order_number}.`, req.user!.id, order.id);
    res.status(201).json({ order: serializeOrder(updated, req.user), created });
  } catch (error) {
    next(error);
  }
});

const deliveryParserDraftSchema = z.object({
  orderId: z.string().optional(),
  orderNumber: z.string().optional(),
  rawText: z.string().min(3),
  preview: z.any()
});

app.post('/api/admin/delivery-parser/draft', sensitiveLimiter, requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const input = deliveryParserDraftSchema.parse(req.body);
    const normalizedOrderNumber = normalizeOrderNumberInput(input.orderNumber);
    const order = input.orderId
      ? await prisma.order.findUnique({ where: { id: input.orderId } })
      : normalizedOrderNumber
        ? await prisma.order.findUnique({ where: { order_number: normalizedOrderNumber } })
        : null;
    if (!order) return res.status(400).json({ message: 'Selecciona una orden pendiente antes de guardar borrador.' });
    if (!isPendingDeliveryStatus(order.status)) return res.status(400).json({ message: 'Esta orden ya no esta pendiente de entrega.' });
    const orderUser = await prisma.user.findUnique({ where: { id: order.user_id } });
    if (!orderUser || !isServimilUser(orderUser)) return res.status(403).json({ message: 'Solo se pueden guardar borradores de Servimil.' });
    const draft = await prisma.deliveryDraft.create({
      data: {
        order_id: order.id,
        raw_text: input.rawText,
        parsed_data: input.preview,
        confidence: Number(input.preview?.confidence || 0),
        status: 'needs_review',
        created_by: req.user!.id
      }
    });
    await addMovement('delivery.draft_created', `Admin guardo borrador de entrega para orden ${order.order_number}.`, req.user!.id, order.id);
    res.status(201).json({ draft });
  } catch (error) {
    next(error);
  }
});

app.get('/api/admin/delivery-drafts', requireAuth, requireRole('admin'), async (_req, res, next) => {
  try {
    const drafts = await prisma.deliveryDraft.findMany({
      orderBy: { created_at: 'desc' },
      take: 80
    });
    const inboundIds = drafts.map((draft) => draft.inbound_message_id).filter(Boolean) as string[];
    const orderIds = drafts.map((draft) => draft.order_id).filter(Boolean) as string[];
    const [inboundMessages, orders] = await Promise.all([
      prisma.whatsAppInboundMessage.findMany({ where: { id: { in: inboundIds } } }),
      prisma.order.findMany({
        where: { id: { in: orderIds } },
        include: { user: true, provider: true, items: { include: { product: true } }, deliveries: { include: { product: true } }, payments: true, providerPayouts: true }
      })
    ]);
    const inboundById = new Map(inboundMessages.map((message) => [message.id, message]));
    const orderById = new Map(orders.map((order) => [order.id, order]));
    res.json({
      drafts: drafts.map((draft) => {
        const inbound = draft.inbound_message_id ? inboundById.get(draft.inbound_message_id) : null;
        const order = draft.order_id ? orderById.get(draft.order_id) : null;
        return {
          id: draft.id,
          inbound_message_id: draft.inbound_message_id,
          order_id: draft.order_id,
          status: draft.status,
          confidence: draft.confidence,
          raw_text: draft.raw_text,
          parsed_data: draft.parsed_data,
          review_notes: draft.review_notes,
          created_at: draft.created_at,
          updated_at: draft.updated_at,
          inbound: inbound ? { id: inbound.id, from: normalizePhone(inbound.from).replace(/\d(?=\d{4})/g, '*'), status: inbound.status, created_at: inbound.created_at } : null,
          order: order ? serializeOrder(order, _req.user) : null
        };
      })
    });
  } catch (error) {
    next(error);
  }
});

const approveDraftSchema = z.object({
  order_id: z.string().optional(),
  accounts: z.array(z.object({
    service: z.string().min(1),
    delivered_email: z.string().optional(),
    delivered_user: z.string().optional(),
    delivered_password: z.string().optional(),
    profile_name: z.string().optional(),
    pin: z.string().optional(),
    notes: z.string().optional(),
    iptv_url: z.string().optional()
  })).optional(),
  review_notes: z.string().optional()
});

app.patch('/api/admin/delivery-drafts/:id/approve', sensitiveLimiter, requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const input = approveDraftSchema.parse(req.body);
    const draft = await prisma.deliveryDraft.findUniqueOrThrow({ where: { id: paramId(req.params.id) } });
    if (!['needs_review', 'draft_created'].includes(draft.status)) return res.status(400).json({ message: 'Este borrador ya fue procesado.' });
    const parsed = draft.parsed_data as any;
    const orderRef = input.order_id || draft.order_id;
    if (!orderRef) return res.status(400).json({ message: 'Selecciona un pedido para aprobar este borrador.' });
    const order = await prisma.order.findUniqueOrThrow({
      where: orderRef.startsWith('ORD-') || orderRef.startsWith('CDD-') ? { order_number: orderRef } : { id: orderRef },
      include: { user: true, provider: true, items: { include: { product: true } }, deliveries: true, payments: true, providerPayouts: true }
    });
    const actorId = await deliveryActorForOrder(order);
    const parserItems = parsed.items as DeliveryParserItem[] | undefined;
    const { created } = parserItems?.length
      ? await createDeliveriesFromAdminItems(order, parserItems, actorId)
      : await createDeliveriesFromParsed(order, { ...parsed, accounts: input.accounts?.length ? input.accounts : parsed.accounts } as ParsedAccountMessage, actorId);
    if (!created) return res.status(400).json({ message: 'No se pudo crear ninguna entrega desde este borrador.' });
    const updatedDraft = await prisma.deliveryDraft.update({
      where: { id: draft.id },
      data: { status: 'approved', order_id: order.id, review_notes: input.review_notes || null, approved_by: req.user!.id, approved_at: new Date() }
    });
    await addMovement('delivery.draft_approved', `Admin aprobo borrador y agrego ${created} cuenta(s).`, req.user!.id, order.id);
    await notifyAdminInboundResult(`Borrador aprobado y cuentas agregadas a la orden ${order.order_number}.`, order.id);
    res.json({ draft: updatedDraft });
  } catch (error) {
    next(error);
  }
});

const rejectDraftSchema = z.object({ review_notes: z.string().optional() });

app.patch('/api/admin/delivery-drafts/:id/reject', sensitiveLimiter, requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const input = rejectDraftSchema.parse(req.body);
    const draft = await prisma.deliveryDraft.update({
      where: { id: paramId(req.params.id) },
      data: { status: 'rejected', review_notes: input.review_notes || null }
    });
    await addMovement('delivery.draft_rejected', `Admin rechazo borrador de entrega ${draft.id}.`, req.user!.id, draft.order_id || undefined);
    res.json({ draft });
  } catch (error) {
    next(error);
  }
});

app.get('/api/admin/provider-config', requireAuth, requireRole('admin'), async (_req, res, next) => {
  try {
    const settings = await getSettingMap();
    const provider = await prisma.user.findFirst({ where: { role: 'provider' }, orderBy: { created_at: 'asc' } });
    const paymentConfig = await getAnyProviderPaymentConfig(provider?.id);
    const latestPayout = await prisma.providerPayout.findFirst({ orderBy: { created_at: 'desc' } });
    const failedPayouts = await prisma.providerPayout.count({ where: { status: 'failed' } });
    res.json({
      config: {
        provider_name: settings.get('provider_name') || 'Proveedor Principal',
        provider_whatsapp_number: settings.get('provider_whatsapp_number') || process.env.WHATSAPP_PROVIDER_NUMBER || '',
        admin_notification_phone: settings.get('admin_notification_phone') || process.env.ADMIN_NOTIFICATION_PHONE || '',
        admin_notification_email: settings.get('admin_notification_email') || process.env.ADMIN_NOTIFICATION_EMAIL || '',
        provider_notifications_active: settings.get('provider_notifications_active') !== 'false',
        provider_notification_method: settings.get('provider_notification_method') || 'bridge',
        bridge_configured: process.env.WHATSAPP_BRIDGE_ENABLED === 'true',
        provider_payment_method: paymentConfig?.method || 'nequi',
        provider_payment_phone: paymentConfig?.phone || '',
        provider_document: paymentConfig?.document || '',
        provider_payment_active: paymentConfig?.active ?? true,
        latest_payout_status: latestPayout?.status || null,
        failed_payouts: failedPayouts
      }
    });
  } catch (error) {
    next(error);
  }
});

app.patch('/api/admin/provider-config', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const input = providerConfigSchema.parse(req.body);
    await Promise.all([
      upsertSetting('provider_name', input.provider_name),
      upsertSetting('provider_whatsapp_number', input.provider_whatsapp_number || ''),
      upsertSetting('admin_notification_phone', input.admin_notification_phone || ''),
      upsertSetting('admin_notification_email', input.admin_notification_email || ''),
      upsertSetting('provider_notifications_active', String(input.provider_notifications_active)),
      upsertSetting('provider_notification_method', input.provider_notification_method)
    ]);
    const provider = await prisma.user.findFirst({ where: { role: 'provider' }, orderBy: { created_at: 'asc' } });
    await prisma.providerPaymentConfig.upsert({
      where: { id: (await getAnyProviderPaymentConfig(provider?.id))?.id || '__new_provider_payment_config__' },
      update: {
        provider_id: provider?.id,
        method: input.provider_payment_method,
        phone: input.provider_payment_phone,
        document: input.provider_document || null,
        active: input.provider_payment_active
      },
      create: {
        provider_id: provider?.id,
        method: input.provider_payment_method,
        phone: input.provider_payment_phone,
        document: input.provider_document || null,
        active: input.provider_payment_active
      }
    });
    await addMovement('provider.config_updated', 'Configuracion privada del proveedor actualizada.', req.user!.id);
    res.json({
      config: {
        ...input,
        bridge_configured: process.env.WHATSAPP_BRIDGE_ENABLED === 'true',
        latest_payout_status: null,
        failed_payouts: 0
      }
    });
  } catch (error) {
    next(error);
  }
});

if (process.env.NODE_ENV === 'production') {
  app.use(express.static(clientDistPath));
  app.get(/^\/(?!api).*/, (_req, res) => {
    res.sendFile(path.join(clientDistPath, 'index.html'));
  });
}

app.use((error: any, _req: Request, res: Response, _next: NextFunction) => {
  if (error instanceof z.ZodError) {
    return res.status(400).json({ message: 'Datos invalidos.', issues: error.issues });
  }
  console.error(error);
  return res.status(500).json({ message: 'Error interno del servidor.' });
});

app.listen(port, '0.0.0.0', () => {
  console.log(`API lista en http://localhost:${port}`);
  void (async () => {
    const adminEnabled = await getSettingValue('whatsapp_bridge_admin_enabled');
    const shouldStart =
      adminEnabled !== 'false' &&
      process.env.WHATSAPP_BRIDGE_AUTOSTART?.trim().toLowerCase() === 'true';
    if (!shouldStart) {
      console.log('WhatsApp Bridge autostart desactivado; el panel interno permanece disponible.');
      return;
    }
    enableWhatsAppBridge();
    await startWhatsAppBridgeWorker(prisma, addMovement, processInboundDeliveryMessage, handleWhatsAppOutboxFinalFailure);
  })().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
  });
});

