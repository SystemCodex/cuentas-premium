import type { PrismaClient } from '@prisma/client';
import { enqueueWhatsAppMessage, getWhatsAppOutboxCounts, processWhatsAppOutbox, retryFailedWhatsAppMessages } from './queue.js';
import { disableWhatsAppWebClient, disconnectWhatsAppWebClient, enableWhatsAppWebClient, getWhatsAppWebRuntimeStatus, initializeWhatsAppWebClient, setWhatsAppInboundHandler } from './whatsappWebClient.js';
import type { AddMovement, QueueWhatsAppMessageInput, WhatsAppInboundHandler, WhatsAppOutboxFailureHandler } from './types.js';

let workerStarted = false;

export async function queueWhatsAppNotification(prisma: PrismaClient, input: QueueWhatsAppMessageInput) {
  return enqueueWhatsAppMessage(prisma, input);
}

export async function getWhatsAppBridgeStatus(prisma: PrismaClient) {
  const runtime = getWhatsAppWebRuntimeStatus();
  const counts = await getWhatsAppOutboxCounts(prisma);
  return {
    enabled: runtime.enabled,
    mode: runtime.mode,
    connection: runtime.connection,
    connectedNumber: runtime.connectedNumber,
    qrPending: runtime.qrPending,
    lastError: runtime.lastError,
    ...counts
  };
}

export function getWhatsAppBridgeQr() {
  return getWhatsAppWebRuntimeStatus().qr;
}

export async function retryFailedWhatsAppOutbox(prisma: PrismaClient) {
  await retryFailedWhatsAppMessages(prisma);
}

export async function disconnectWhatsAppBridge() {
  await disconnectWhatsAppWebClient();
  disableWhatsAppWebClient();
}

export function enableWhatsAppBridge() {
  enableWhatsAppWebClient();
}

export async function startWhatsAppBridgeWorker(prisma: PrismaClient, addMovement: AddMovement, inboundHandler?: WhatsAppInboundHandler, onFinalFailure?: WhatsAppOutboxFailureHandler) {
  if (inboundHandler) setWhatsAppInboundHandler(inboundHandler);
  if (!workerStarted) {
    workerStarted = true;
    windowlessInterval(async () => {
      await initializeWhatsAppWebClient();
      await processWhatsAppOutbox(prisma, addMovement, onFinalFailure);
    }, 5000);
  }
  await initializeWhatsAppWebClient();
}

function windowlessInterval(task: () => Promise<void>, ms: number) {
  setInterval(() => {
    task().catch(() => null);
  }, ms);
}
