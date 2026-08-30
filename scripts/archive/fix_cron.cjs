const fs = require('fs');
let code = fs.readFileSync('server.js', 'utf8');

const badBlockStart = `                            if (channels.email && company.email) {
                               try {
                                    const htmlContent = specificDocs.length > 0 
                                    ? buildEmailHtml(msg.message, companySpecificDocs, settings?.emailSignature)
                                    : buildEmailHtml(msg.message, [], settings?.emailSignature);`;

const badBlockEnd = `                                    waBody += \`\\n\\n\${settings?.whatsappTemplate || ''}\`;

                                    await safeSendMessage(waWrapper.client, chatId, waBody);`;

const startIdx = code.indexOf(badBlockStart);
const endIdx = code.indexOf(badBlockEnd, startIdx);

if (startIdx === -1 || endIdx === -1) {
    console.log('Indexes not found!');
    process.exit(1);
}

const correctBlock = `                            const processedMessage = processMessageVars(msg.message, company);
                            const processedTitle = processMessageVars(msg.title, company);

                            if (channels.email && company.email) {
                               try {
                                    const htmlContent = specificDocs.length > 0 
                                    ? buildEmailHtml(processedMessage, companySpecificDocs, settings?.emailSignature)
                                    : buildEmailHtml(processedMessage, [], settings?.emailSignature);

                                    const emailList = company.email.split(',').map(e => e.trim()).filter(e => e);
                                    const mainEmail = emailList[0];
                                    const ccEmails = emailList.slice(1).join(', ');

                                    if (mainEmail) {
                                        const senderName = process.env.EMAIL_FROM_NAME || 'Contabilidade';
                                        const senderEmail = process.env.EMAIL_FROM_EMAIL || process.env.EMAIL_USER;
                                        const fromAddress = \`"\${senderName}" <\${senderEmail}>\`;

                                        const mailOptions = {
                                            from: fromAddress,
                                            to: mainEmail,
                                            cc: ccEmails,
                                            subject: processedTitle,
                                            html: htmlContent,
                                            attachments: attachmentsToSend.map(a => ({ filename: a.filename, path: a.path, contentType: a.contentType }))
                                        };

                                        await emailTransporter.sendMail(mailOptions);
                                        await saveToImapSentFolder(mailOptions).catch(err => 
                                            log('[CRON] Falha ao salvar no IMAP', err)
                                        );
                                    }
                               } catch(e) { log(\`[CRON] Erro email \${company.name}\`, e); }
                            }

                            if (channels.whatsapp && company.whatsapp && clientReady) {
                                try {
                                    let number = company.whatsapp.replace(/\\D/g, '');
                                    if (!number.startsWith('55')) number = '55' + number;
                                    const chatId = \`\${number}@c.us\`;
                                    
                                    let waBody = \`*\${processedTitle}*\\n\\n\${processedMessage}\`;

                                    if (specificDocs.length > 0) {
                                        const listaArquivos = attachmentsToSend.map(att => 
                                            \`• \${att.docData?.docName || att.filename} (\${att.docData?.category || 'Anexo'}, Venc: \${att.docData?.dueDate || 'N/A'})\`
                                        ).join('\\n');
                                        waBody += \`\\n\\n*Arquivos enviados:*\\n\${listaArquivos}\`;
                                    } else if (attachmentsToSend.length > 0) {
                                        waBody += \`\\n\\n*Arquivo enviado:* \${attachmentsToSend[0].filename}\`;
                                    }
                                    
                                    const whatsappSignature = settings?.whatsappFileSignature || settings?.whatsappTemplate || '';
                                    waBody += \`\\n\\n\${whatsappSignature}\`;

                                    await safeSendMessage(waWrapper.client, chatId, waBody);`;

const fixedCode = code.slice(0, startIdx) + correctBlock + code.slice(endIdx + badBlockEnd.length);
fs.writeFileSync('server.js', fixedCode, 'utf8');
console.log('Fixed cron in server.js');
