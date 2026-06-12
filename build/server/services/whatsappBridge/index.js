import { enqueueWhatsAppMessage, getWhatsAppOutboxCounts, processWhatsAppOutbox, retryFailedWhatsAppMessages } from './queue.js';
import { disableWhatsAppWebClient, disconnectWhatsAppWebClient, enableWhatsAppWebClient, getWhatsAppWebRuntimeStatus, initializeWhatsAppWebClient, setWhatsAppInboundHandler } from './whatsappWebClient.js';
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
    disableWhatsAppWebClient();
}
export function enableWhatsAppBridge() {
    enableWhatsAppWebClient();
}
export async function startWhatsAppBridgeWorker(prisma, addMovement, inboundHandler, onFinalFailure) {
    if (inboundHandler)
        setWhatsAppInboundHandler(inboundHandler);
    if (!workerStarted) {
        workerStarted = true;
        windowlessInterval(async () => {
            await initializeWhatsAppWebClient();
            await processWhatsAppOutbox(prisma, addMovement, onFinalFailure);
        }, 5000);
    }
    await initializeWhatsAppWebClient();
}
function windowlessInterval(task, ms) {
    setInterval(() => {
        task().catch(() => null);
    }, ms);
}
