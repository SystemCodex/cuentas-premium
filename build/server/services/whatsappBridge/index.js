import { enqueueWhatsAppMessage, getWhatsAppOutboxCounts, processWhatsAppOutbox, retryFailedWhatsAppMessages } from './queue.js';
import { disconnectWhatsAppWebClient, getWhatsAppWebRuntimeStatus, initializeWhatsAppWebClient, setWhatsAppInboundHandler } from './whatsappWebClient.js';
let workerStarted = false;
export async function queueWhatsAppNotification(prisma, input) {
    return enqueueWhatsAppMessage(prisma, input);
}
export async function getWhatsAppBridgeStatus(prisma) {
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
export async function retryFailedWhatsAppOutbox(prisma) {
    await retryFailedWhatsAppMessages(prisma);
}
export async function disconnectWhatsAppBridge() {
    await disconnectWhatsAppWebClient();
}
export async function startWhatsAppBridgeWorker(prisma, addMovement, inboundHandler, onFinalFailure) {
    if (workerStarted)
        return;
    workerStarted = true;
    if (inboundHandler)
        setWhatsAppInboundHandler(inboundHandler);
    await initializeWhatsAppWebClient();
    windowlessInterval(async () => {
        await initializeWhatsAppWebClient();
        await processWhatsAppOutbox(prisma, addMovement, onFinalFailure);
    }, 5000);
}
function windowlessInterval(task, ms) {
    setInterval(() => {
        task().catch(() => null);
    }, ms);
}
