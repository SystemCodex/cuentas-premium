import nodemailer from 'nodemailer';
function smtpPort() {
    return Number(process.env.SMTP_PORT || 587);
}
export function emailConfigured() {
    return Boolean(process.env.SMTP_HOST && process.env.SMTP_FROM);
}
export async function sendSmtpEmail(message) {
    if (!emailConfigured())
        throw new Error('SMTP no configurado.');
    const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: smtpPort(),
        secure: smtpPort() === 465,
        auth: process.env.SMTP_USER && process.env.SMTP_PASS
            ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
            : undefined
    });
    await transporter.sendMail({
        from: process.env.SMTP_FROM,
        to: message.to,
        subject: message.subject,
        text: message.text
    });
}
