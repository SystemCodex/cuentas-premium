import { deliveryServiceFromText } from './serviceAliases.js';
function cleanText(rawText) {
    return rawText
        .replace(/[|*_`~]/g, ' ')
        .replace(/[📦🍿⏱️📩🔑👤🔒✅➡️]/g, '')
        .replace(/[^\S\r\n]+/g, ' ')
        .trim();
}
function field(block, labels) {
    for (const label of labels) {
        const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const match = block.match(new RegExp(`${escaped}\\s*[:\\-]?\\s*([^\\n\\r]+)`, 'i'));
        if (match?.[1])
            return match[1].trim();
    }
    return undefined;
}
function firstEmail(text) {
    return text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0];
}
function firstUrl(text) {
    return text.match(/https?:\/\/\S+/i)?.[0];
}
function splitBlocks(text) {
    const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (lines.length <= 2)
        return [text];
    const blocks = [];
    let current = [];
    for (const line of lines) {
        const service = deliveryServiceFromText(line);
        const titleLike = Boolean(service) && line.length < 90 && !/(correo|email|mail|usuario\s*:|contras|clave|password|pass|pin\s*:)/i.test(line);
        if (titleLike && current.length) {
            blocks.push(current.join('\n'));
            current = [line];
        }
        else {
            current.push(line);
        }
    }
    if (current.length)
        blocks.push(current.join('\n'));
    return blocks;
}
function parseLoose(block) {
    const email = firstEmail(block);
    if (!email)
        return {};
    const afterEmail = block.slice(block.indexOf(email) + email.length).trim().split(/\s+/)[0];
    return { delivered_email: email, delivered_password: afterEmail || undefined };
}
export function parseRawDeliveryMessage(rawText) {
    const normalized = cleanText(rawText);
    const warnings = [];
    const items = splitBlocks(normalized).map((block) => {
        const service = deliveryServiceFromText(block);
        const loose = parseLoose(block);
        const delivered_email = field(block, ['correo', 'email', 'mail']) || loose.delivered_email;
        const delivered_user = field(block, ['usuario', 'user', 'cuenta']);
        const delivered_password = field(block, ['contrasena', 'contraseña', 'clave', 'password', 'pass']) || loose.delivered_password;
        const profile_name = field(block, ['perfil']);
        const pin = field(block, ['pin de seguridad', 'seguridad', 'pin']);
        const iptv_url = field(block, ['url para smarters iptv', 'url iptv', 'url']) || firstUrl(block);
        const notes = [iptv_url ? `URL IPTV: ${iptv_url}` : undefined].filter(Boolean).join(' | ') || undefined;
        const hasAccess = Boolean((delivered_email || delivered_user) && delivered_password);
        const confidence = Math.min(100, 35 + (service ? 25 : 0) + (hasAccess ? 35 : 0) + (pin || profile_name || iptv_url ? 5 : 0));
        return {
            serviceName: service?.canonical || 'Servicio sin identificar',
            delivered_email,
            delivered_user,
            delivered_password,
            profile_name,
            pin,
            iptv_url,
            notes,
            confidence,
            needsReview: !service || !hasAccess
        };
    }).filter((item) => item.serviceName !== 'Servicio sin identificar' || item.delivered_email || item.delivered_user || item.delivered_password);
    if (!items.length)
        warnings.push('No se detectaron cuentas en el mensaje.');
    for (const item of items) {
        if (item.needsReview)
            warnings.push(`${item.serviceName}: requiere revision por datos incompletos o servicio no identificado.`);
    }
    const confidence = items.length ? Math.round(items.reduce((sum, item) => sum + item.confidence, 0) / items.length) : 0;
    return { confidence, items, warnings };
}
