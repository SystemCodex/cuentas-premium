import { serviceKeyFromText } from './serviceAliases.js';
function cleanText(text) {
    return text
        .replace(/[|*_`~]/g, ' ')
        .replace(/[^\S\r\n]+/g, ' ')
        .replace(/[📦🍿⏱️📩🔑👤🔒✅➡️]/g, '')
        .trim();
}
function findField(block, labels) {
    for (const label of labels) {
        const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`${escaped}\\s*[:\\-]?\\s*([^\\n\\r]+)`, 'i');
        const match = block.match(regex);
        if (match?.[1])
            return match[1].trim();
    }
    return undefined;
}
function emailFrom(block) {
    return block.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0];
}
function splitServiceBlocks(text) {
    const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const blocks = [];
    let current = null;
    for (const line of lines) {
        const serviceKey = serviceKeyFromText(line);
        const looksLikeTitle = serviceKey && line.length <= 80 && !/@/.test(line) && !/contrase|clave|password|correo|usuario\s*:/i.test(line);
        if (looksLikeTitle) {
            if (current)
                blocks.push(current);
            current = { title: line, body: [] };
        }
        else if (current) {
            current.body.push(line);
        }
        else {
            current = { title: line, body: [] };
        }
    }
    if (current)
        blocks.push(current);
    return blocks;
}
function parseLooseLine(text) {
    const email = emailFrom(text);
    if (!email)
        return null;
    const afterEmail = text.slice(text.indexOf(email) + email.length).trim().split(/\s+/)[0];
    const service = serviceKeyFromText(text) || 'servicio';
    return {
        service,
        delivered_email: email,
        delivered_password: afterEmail,
        notes: text.replace(email, '').replace(afterEmail || '', '').trim() || undefined
    };
}
export function parseAccountMessage(message) {
    const normalizedText = cleanText(message);
    const orderHint = normalizedText.match(/pedido\s*[:#-]?\s*([a-z0-9-]{6,})/i)?.[1];
    const blocks = splitServiceBlocks(normalizedText);
    const accounts = [];
    for (const block of blocks) {
        const blockText = [block.title, ...block.body].join('\n');
        const service = serviceKeyFromText(block.title) || serviceKeyFromText(blockText);
        const loose = parseLooseLine(blockText);
        const delivered_email = findField(blockText, ['correo', 'email', 'mail']) || loose?.delivered_email;
        const delivered_user = findField(blockText, ['usuario', 'user', 'login']);
        const delivered_password = findField(blockText, ['contrasena', 'contraseña', 'clave', 'password']) || loose?.delivered_password;
        const profile_name = findField(blockText, ['perfil', 'usuario perfil']);
        const pin = findField(blockText, ['pin de seguridad', 'pin']);
        const iptv_url = findField(blockText, ['url para smarters iptv', 'url iptv', 'url']);
        if (service || delivered_email || delivered_user || delivered_password || loose) {
            accounts.push({
                service: service || loose?.service || 'servicio',
                delivered_email,
                delivered_user,
                delivered_password,
                profile_name,
                pin,
                iptv_url,
                notes: [loose?.notes, iptv_url ? `URL IPTV: ${iptv_url}` : undefined].filter(Boolean).join(' | ') || undefined
            });
        }
    }
    const completeAccounts = accounts.filter((account) => (account.delivered_email || account.delivered_user) && account.delivered_password);
    let confidence = 35;
    if (orderHint)
        confidence += 25;
    if (accounts.length > 0)
        confidence += 15;
    if (completeAccounts.length === accounts.length && accounts.length > 0)
        confidence += 25;
    if (accounts.some((account) => account.service === 'servicio'))
        confidence -= 10;
    confidence = Math.max(0, Math.min(100, confidence));
    return { orderHint, confidence, accounts, normalizedText };
}
