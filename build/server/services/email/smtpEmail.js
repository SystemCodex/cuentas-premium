import nodemailer from 'nodemailer';
function smtpPort() {
    return Number(process.env.SMTP_PORT || 587);
}
export function getEnvironmentSmtpConfig() {
    const port = smtpPort();
    return {
        host: process.env.SMTP_HOST || '',
        port,
        secure: process.env.SMTP_SECURE
            ? process.env.SMTP_SECURE.trim().toLowerCase() === 'true'
            : port === 465,
        user: process.env.SMTP_USER || '',
        pass: process.env.SMTP_PASS || '',
        from: process.env.SMTP_FROM || process.env.SMTP_USER || ''
    };
}
export function emailConfigured(config = getEnvironmentSmtpConfig()) {
    return Boolean(config.host
        && config.from
        && (!config.user || config.pass));
}
function createSmtpTransport(config) {
    if (!config.host || !config.from)
        throw new Error('SMTP no configurado.');
    if (config.user && !config.pass) {
        throw new Error('Falta la contrasena de aplicacion SMTP.');
    }
    return nodemailer.createTransport({
        host: config.host,
        port: config.port,
        secure: config.secure,
        auth: config.user && config.pass
            ? { user: config.user, pass: config.pass }
            : undefined
    });
}
export async function verifySmtpConnection(config = getEnvironmentSmtpConfig()) {
    const transporter = createSmtpTransport(config);
    await transporter.verify();
}
export async function sendSmtpEmail(message, config = getEnvironmentSmtpConfig()) {
    const transporter = createSmtpTransport(config);
    await transporter.sendMail({
        from: config.from,
        to: message.to,
        subject: message.subject,
        text: message.text
    });
}
