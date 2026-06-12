import crypto from 'node:crypto';
import { BufferJSON, initAuthCreds, proto } from 'baileys';
export const BAILEYS_CREDS_SETTING = 'whatsapp_baileys_creds_v1';
export const BAILEYS_KEYS_SETTING = 'whatsapp_baileys_keys_v1';
function encryptionKey() {
    const secret = process.env.APP_ENCRYPTION_KEY;
    if (!secret)
        throw new Error('APP_ENCRYPTION_KEY es requerido para proteger la sesion de WhatsApp.');
    return crypto.createHash('sha256').update(secret).digest();
}
function encrypt(value) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${iv.toString('base64')}.${tag.toString('base64')}.${encrypted.toString('base64')}`;
}
function decrypt(value) {
    const [ivRaw, tagRaw, dataRaw] = value.split('.');
    if (!ivRaw || !tagRaw || !dataRaw)
        throw new Error('La sesion cifrada de WhatsApp no tiene un formato valido.');
    const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(ivRaw, 'base64'));
    decipher.setAuthTag(Buffer.from(tagRaw, 'base64'));
    return Buffer.concat([
        decipher.update(Buffer.from(dataRaw, 'base64')),
        decipher.final()
    ]).toString('utf8');
}
function serialize(value) {
    return JSON.stringify(value, BufferJSON.replacer);
}
function deserialize(value) {
    return JSON.parse(value, BufferJSON.reviver);
}
async function readEncryptedSetting(prisma, key) {
    const setting = await prisma.appSetting.findUnique({ where: { key } });
    if (!setting?.value)
        return null;
    return deserialize(decrypt(setting.value));
}
async function saveEncryptedSetting(prisma, key, value) {
    const encrypted = encrypt(serialize(value));
    await prisma.appSetting.upsert({
        where: { key },
        update: { value: encrypted, private: true },
        create: { key, value: encrypted, private: true }
    });
}
export async function createBaileysDatabaseAuthState(prisma) {
    const creds = await readEncryptedSetting(prisma, BAILEYS_CREDS_SETTING)
        || initAuthCreds();
    const keySnapshot = await readEncryptedSetting(prisma, BAILEYS_KEYS_SETTING)
        || {};
    let writeQueue = Promise.resolve();
    const queueWrite = (task) => {
        writeQueue = writeQueue.then(task, task);
        return writeQueue;
    };
    const state = {
        creds,
        keys: {
            get: async (type, ids) => {
                const values = {};
                for (const id of ids) {
                    let value = keySnapshot[type]?.[id];
                    if (type === 'app-state-sync-key' && value) {
                        value = proto.Message.AppStateSyncKeyData.fromObject(value);
                    }
                    if (value)
                        values[id] = value;
                }
                return values;
            },
            set: async (data) => {
                for (const [category, entries] of Object.entries(data)) {
                    if (!entries)
                        continue;
                    keySnapshot[category] ||= {};
                    for (const [id, value] of Object.entries(entries)) {
                        if (value === null || value === undefined) {
                            delete keySnapshot[category][id];
                        }
                        else {
                            keySnapshot[category][id] = value;
                        }
                    }
                    if (!Object.keys(keySnapshot[category]).length)
                        delete keySnapshot[category];
                }
                await queueWrite(() => saveEncryptedSetting(prisma, BAILEYS_KEYS_SETTING, keySnapshot));
            }
        }
    };
    return {
        state,
        saveCreds: () => queueWrite(() => saveEncryptedSetting(prisma, BAILEYS_CREDS_SETTING, state.creds)),
        clear: async () => {
            await writeQueue.catch(() => undefined);
            await prisma.appSetting.deleteMany({
                where: { key: { in: [BAILEYS_CREDS_SETTING, BAILEYS_KEYS_SETTING] } }
            });
        }
    };
}
