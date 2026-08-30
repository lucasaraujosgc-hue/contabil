import nodemailer from 'nodemailer';
import { ImapFlow } from 'imapflow';
import { log } from '../logger.js';
import { APP_BASE_URL } from '../config.js';

// --- EMAIL CONFIGURATION --- (extraído do server.js, sem alterações)
const emailPort = parseInt(process.env.EMAIL_PORT || '465');
export const emailTransporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST || 'smtp.gmail.com',
    port: emailPort,
    secure: emailPort === 465,
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
});

const pickOrCreateSentMailbox = async (imap) => {
    if (process.env.SENT_FOLDER) {
        log(`[IMAP] Usando pasta configurada: ${process.env.SENT_FOLDER}`);
        return process.env.SENT_FOLDER;
    }

    const candidates = [
        'INBOX.Sent',
    ];

    const findMailbox = async () => {
        for await (const box of imap.list()) {
            if (candidates.includes(box.path) || candidates.includes(box.name)) {
                return box.path;
            }
        }
        return null;
    };

    let folder = await findMailbox();
    if (folder) return folder;

    for (const name of ['Sent', 'Enviados']) {
        try {
            await imap.mailboxCreate(name);
            folder = await findMailbox();
            if (folder) return folder;
        } catch (e) {
            // tenta o próximo nome
        }
    }

    return 'Sent';
};

export const saveToImapSentFolder = async (mailOptions) => {
    let imap;
    try {
        const emailUser = process.env.EMAIL_USER;
        const emailPass = process.env.EMAIL_PASS;

        if (!emailUser || !emailPass) {
            log('[IMAP] EMAIL_USER e EMAIL_PASS não configurados. Ignorando IMAP.');
            return;
        }

        const imapHost = process.env.IMAP_HOST || 'imap.hostinger.com';
        const imapPort = parseInt(process.env.IMAP_PORT || '993');
        const imapSecure = process.env.IMAP_SECURE !== 'false';

        const mimePreview = nodemailer.createTransport({
            streamTransport: true,
            buffer: true,
            newline: 'unix',
        });

        const mime = await mimePreview.sendMail({
            ...mailOptions,
            from: mailOptions.from || emailUser,
            date: new Date(),
            text: mailOptions.text || ' ',
            html: mailOptions.html || '<p></p>',
        });

        imap = new ImapFlow({
            host: imapHost,
            port: imapPort,
            secure: imapSecure,
            auth: {
                user: emailUser,
                pass: emailPass,
            },
            tls: { rejectUnauthorized: false },
            logger: false,
        });

        await imap.connect();

        const sentFolder = await pickOrCreateSentMailbox(imap);
        const rawMessage = Buffer.from(mime.message.toString(), 'utf-8');
        await imap.append(sentFolder, rawMessage);

        log(`[IMAP] Email salvo na pasta ${sentFolder} com sucesso.`);
    } catch (err) {
        log(`[IMAP Error] ${err.message}`, err);
    } finally {
        if (imap) await imap.logout().catch(() => {});
    }
};

// --- Convite de colaborador ---
export async function sendInviteEmail(agent, rawToken, { reset = false } = {}) {
    if (!agent?.email) throw new Error('Colaborador sem e-mail cadastrado.');
    const link = `${APP_BASE_URL}/definir-acesso?token=${encodeURIComponent(rawToken)}`;
    const title = reset ? 'Redefinição de acesso — Contábil Manager Pro'
                        : 'Convite para o Contábil Manager Pro';
    const acao = reset ? 'redefinir sua senha' : 'criar seu acesso';
    const html = `
      <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:520px;margin:0 auto;color:#333">
        <h2 style="color:#2563eb">Contábil Manager Pro</h2>
        <p>Olá, <strong>${agent.name}</strong>.</p>
        <p>${reset ? 'Foi solicitada uma redefinição de acesso para a sua conta.'
                   : 'Você foi convidado para acessar o Contábil Manager Pro.'}
           Clique no botão abaixo para ${acao}. O link expira em 48 horas e só pode ser usado uma vez.</p>
        <p style="margin:28px 0">
          <a href="${link}" style="background:#2563eb;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:bold">
            ${reset ? 'Redefinir senha' : 'Criar meu acesso'}
          </a>
        </p>
        <p style="font-size:13px;color:#64748b">Se o botão não funcionar, copie e cole no navegador:<br>${link}</p>
      </div>`;
    const senderName = process.env.EMAIL_FROM_NAME || 'Contábil Manager Pro';
    const senderEmail = process.env.EMAIL_FROM_EMAIL || process.env.EMAIL_USER;
    const mailOptions = {
        from: `"${senderName}" <${senderEmail}>`,
        to: agent.email,
        subject: title,
        html,
    };
    await emailTransporter.sendMail(mailOptions);
    await saveToImapSentFolder(mailOptions).catch((err) => log('[Invite] Falha ao salvar no IMAP', err));
    log(`[Invite] E-mail de ${reset ? 'reset' : 'convite'} enviado para ${agent.email}`);
}

// --- HTML / message helpers ---
export const processMessageVars = (msg, company) => {
    if (!msg) return '';
    let result = msg;
    const apelido = company.nickname || company.name || '';
    result = result.replace(/\{apelido\}/gi, apelido);
    return result;
};

export const buildEmailHtml = (messageBody, documents, emailSignature) => {
    let docsTable = '';
    if (documents && documents.length > 0) {
        const sortedDocs = [...documents].sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || ''));
        let rows = '';
        sortedDocs.forEach(doc => {
            rows += `<tr style="border-bottom: 1px solid #eee;"><td style="padding: 10px; color: #333;">${doc.docName}</td><td style="padding: 10px; color: #555;">${doc.category}</td><td style="padding: 10px; color: #555;">${doc.dueDate || 'N/A'}</td><td style="padding: 10px; color: #555;">${doc.competence}</td></tr>`;
        });
        docsTable = `<h3 style="color: #2c3e50; border-bottom: 2px solid #eff6ff; padding-bottom: 10px; margin-top: 30px; font-size: 16px;">Documentos em Anexo:</h3><table style="width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 14px;"><thead><tr style="background-color: #f8fafc; color: #64748b;"><th style="padding: 10px; text-align: left; border-bottom: 2px solid #e2e8f0;">Documento</th><th style="padding: 10px; text-align: left; border-bottom: 2px solid #e2e8f0;">Categoria</th><th style="padding: 10px; text-align: left; border-bottom: 2px solid #e2e8f0;">Vencimento</th><th style="padding: 10px; text-align: left; border-bottom: 2px solid #e2e8f0;">Competência</th></tr></thead><tbody>${rows}</tbody></table>`;
    }
    
    let htmlBody = (messageBody || '')
        .replace(/\n/g, '<br>')
        .replace(/\*(.*?)\*/g, '<b>$1</b>')
        .replace(/_(.*?)_/g, '<i>$1</i>');

    return `<html><body style="font-family: 'Segoe UI', Arial, sans-serif; line-height: 1.6; color: #333; background-color: #f4f4f4; margin: 0; padding: 20px;"><div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; padding: 30px; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.05);"><div style="background-color: #f8f9fa; padding: 20px; border-radius: 6px; border-left: 4px solid #2563eb; margin-bottom: 25px;">${htmlBody}</div>${docsTable}<div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #e2e8f0; font-size: 14px; color: #64748b;">${emailSignature || ''}</div></div></body></html>`;
};
