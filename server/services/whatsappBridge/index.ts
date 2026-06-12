import type { PrismaClient } from '@prisma/client';
import { enqueueWhatsAppMessage, getWhatsAppOutboxCounts, processWhatsAppOutbox, retryFailedWhatsAppMessages } from './queue.js';
import { disableWhatsAppClient, disconnectWhatsAppClient, enableWhatsAppClient, getWhatsAppRuntimeStatus, initializeWhatsAppClient, setWhatsAppInboundHandler } from './baileysClient.js';
import type { AddMovement, QueueWhatsAppMessageInput, WhatsAppInboundHandler, WhatsAppOutboxFailureHandler } from './types.js';

let workerStarted = false;

export async function queueWhatsAppNotification(prisma: PrismaClient, input: QueueWhatsAppMessageInput) {
  return enqueueWhatsAppMessage(prisma, input);
}

export async function getWhatsAppBridgeStatus(prisma: PrismaClient) {
  const runtime = getWhatsAppRuntimeStatus();
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
  return getWhatsAppRuntimeStatus().qr;
}

export async function retryFailedWhatsAppOutbox(prisma: PrismaClient) {
  await retryFailedWhatsAppMessages(prisma);
}

export async function disconnectWhatsAppBridge() {
  await disconnectWhatsAppClient();
  disableWhatsAppClient();
}

export function enableWhatsAppBridge() {
  enableWhatsAppClient();
}

export async function startWhatsAppBridgeWorker(prisma: PrismaClient, addMovement: AddMovement, inboundHandler?: WhatsAppInboundHandler, onFinalFailure?: WhatsAppOutboxFailureHandler) {
  if (inboundHandler) setWhatsAppInboundHandler(inboundHandler);
  if (!workerStarted) {
    workerStarted = true;
    windowlessInterval(async () => {
      await initializeWhatsAppClient(prisma);
      await processWhatsAppOutbox(prisma, addMovement, onFinalFailure);
    }, 5000);
  }
  await initializeWhatsAppClient(prisma);
}

function windowlessInterval(task: () => Promise<void>, ms: number) {
  setInterval(() => {
    task().catch(() => null);
  }, ms);
}
